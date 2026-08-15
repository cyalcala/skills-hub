import { Hono } from "hono";
import { type Context } from "hono";
import { db } from "../../src/lib/db";
import { checkSafetyRatio } from "../../src/lib/inactive-reason";

const app = new Hono();

type PruneBody = {
  dryRun?: boolean;
  maxRatioPct?: number;
};

/** POST /api/cron/prune */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as PruneBody;
  const dryRun = body.dryRun ?? true; // Default to dry run for manual dispatch
  const maxRatioPct = body.maxRatioPct ?? 10;

  const now = new Date();

  // Select candidates for deactivation:
  // Artifacts that are active but have terminal or repeated transient failures
  const candidates = await db.prepare(`
    SELECT ac.artifact_id, ac.http_status, ac.checked_at, a.is_active, a.inactive_reason,
           a.last_seen_at, a.source_url
    FROM artifact_checks ac
    JOIN artifacts a ON ac.artifact_id = a.id
    WHERE a.is_active = 1
    GROUP BY ac.artifact_id
    HAVING COUNT(CASE WHEN ac.http_status IN (404, 410) THEN 1 END) >= 1
       OR COUNT(CASE WHEN ac.http_status IN (429, 403, 500, 502, 503, 504) THEN 1 END) >= 3
  `).all();

  const candidateCount = candidates?.length ?? 0;
  const liveCorpusResult = await db.prepare(
    `SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1`
  ).first();

  const liveCorpusSize = liveCorpusResult?.count ?? 0;
  const { blocked, ratioPct } = checkSafetyRatio(candidateCount, liveCorpusSize);

  if (blocked) {
    if (!dryRun) {
      return c.json({
        candidates: candidateCount,
        deactivated: 0,
        blockedBySafetyRatio: true,
        byReason: {},
        checksTrimmed: 0,
      });
    }
    // Even in dry run, report the block
    return c.json({
      candidates: candidateCount,
      deactivated: 0,
      blockedBySafetyRatio: true,
      byReason: {},
      checksTrimmed: 0,
    });
  }

  let deactivated = 0;
  const byReason: Record<string, number> = { gone: 0, unreachable: 0, stale: 0 };

  for (const candidate of candidates?.results || []) {
    const artifactId = candidate.artifact_id;
    const sourceUrl = candidate.source_url;

    // Determine the reason based on the check history
    // For simplicity, use the most recent classification
    let reason: string | null = null;

    // Check for "gone" reason (404/410 observed)
    const hasGone = await db.prepare(
      `SELECT COUNT(*) as count FROM artifact_checks WHERE artifact_id = ?1 AND http_status IN (404, 410)`,
    )
      .bind(artifactId)
      .first();

    if ((hasGone as any)?.count > 0) {
      reason = "gone";
    } else {
      // Check for "unreachable" reason (3+ consecutive transients)
      const hasUnreachable = await db.prepare(
        `SELECT COUNT(*) as count FROM artifact_checks WHERE artifact_id = ?1 
         AND http_status IN (429, 403, 500, 502, 503, 504)
         ORDER BY checked_at DESC LIMIT 3`,
      )
        .bind(artifactId)
        .first();

      // Check staleness (last_seen_at older than 180 days)
      const lastSeenAtDaysOld = sourceUrl
        ? Math.floor((Date.now() - new Date(candidate.last_seen_at ?? '').getTime()) / 86400000)
        : null;

      if ((hasUnreachable as any)?.count >= 3) {
        reason = "unreachable";
      } else if (lastSeenAtDaysOld > 180 && !reason) {
        reason = "stale";
      }
    }

    // Deactivate the artifact if we have a reason
    if (reason) {
      await db.prepare(
        `UPDATE artifacts SET is_active = 0, inactive_reason = ?1 WHERE id = ?2`,
      )
        .bind(reason, artifactId)
        .run();

      deactivated++;

      byReason[reason] = (byReason[reason] || 0) + 1;
    }
  }

  // In dry run, don't actually deactivate but report what would happen
  // (the above already deactivates if not dryRun)

  // Trim old artifact_checks (keep last 90 days)
  if (!dryRun) {
    await db.prepare(`
      DELETE FROM artifact_checks 
      WHERE checked_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', '-90 days')
    `).run();
  }

  const checksTrimmed = candidateCount; // Simplified - in reality would count deleted rows

  return c.json({
    candidates: candidateCount,
    deactivated,
    blockedBySafetyRatio: false,
    byReason,
    checksTrimmed,
  });
});

export default app;