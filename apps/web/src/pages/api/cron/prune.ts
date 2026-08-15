import { Hono } from "hono";
import { type Context } from "hono";
import type { APIContext } from "astro";
import type { D1Database } from "@cloudflare/workers-types";
import { checkSafetyRatio } from "../../../lib/inactive-reason";

const app = new Hono().basePath("/api/cron/prune");

type PruneBody = {
  dryRun?: boolean;
  maxRatioPct?: number;
};

interface PruneCandidate {
  artifact_id: number;
  http_status: number;
  checked_at: string;
  is_active: number;
  inactive_reason: string | null;
  last_seen_at: string | null;
  source_url: string;
}

/** POST /api/cron/prune */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as PruneBody;
  const dryRun = body.dryRun ?? true; // Default to dry run for manual dispatch
  const DB = c.env.DB as D1Database;

  // Select candidates for deactivation:
  // Artifacts that are active but have terminal or repeated transient failures
  const candidates = await DB.prepare(`
    SELECT ac.artifact_id, ac.http_status, ac.checked_at, a.is_active, a.inactive_reason,
           a.last_seen_at, a.source_url
    FROM artifact_checks ac
    JOIN artifacts a ON ac.artifact_id = a.id
    WHERE a.is_active = 1
    GROUP BY ac.artifact_id
    HAVING COUNT(CASE WHEN ac.http_status IN (404, 410) THEN 1 END) >= 1
       OR COUNT(CASE WHEN ac.http_status IN (429, 403, 500, 502, 503, 504) THEN 1 END) >= 3
  `).all<PruneCandidate>();

  const candidateCount = candidates?.results?.length ?? 0;
  const liveCorpusResult = await DB.prepare(
    `SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1`
  ).first<{ count: number }>();

  const liveCorpusSize = liveCorpusResult?.count ?? 0;
  const { blocked } = checkSafetyRatio(candidateCount, liveCorpusSize);

  if (blocked) {
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

  for (const candidate of candidates?.results ?? []) {
    const artifactId = candidate.artifact_id;

    // Determine the reason based on the check history
    let reason: string | null = null;

    // Check for "gone" reason (404/410 observed)
    const hasGone = await DB.prepare(
      `SELECT COUNT(*) as count FROM artifact_checks WHERE artifact_id = ?1 AND http_status IN (404, 410)`,
    )
      .bind(artifactId)
      .first<{ count: number }>();

    if ((hasGone?.count ?? 0) > 0) {
      reason = "gone";
    } else {
      // Check for "unreachable" reason (3+ transients)
      const hasUnreachable = await DB.prepare(
        `SELECT COUNT(*) as count FROM artifact_checks WHERE artifact_id = ?1 
         AND http_status IN (429, 403, 500, 502, 503, 504)`,
      )
        .bind(artifactId)
        .first<{ count: number }>();

      // Check staleness (last_seen_at older than 180 days)
      const lastSeenAtDaysOld = candidate.last_seen_at
        ? Math.floor((Date.now() - new Date(candidate.last_seen_at).getTime()) / 86400000)
        : null;

      if ((hasUnreachable?.count ?? 0) >= 3) {
        reason = "unreachable";
      } else if (lastSeenAtDaysOld !== null && lastSeenAtDaysOld > 180) {
        reason = "stale";
      }
    }

    // Deactivate the artifact if we have a reason
    if (reason) {
      if (!dryRun) {
        await DB.prepare(
          `UPDATE artifacts SET is_active = 0, inactive_reason = ?1 WHERE id = ?2`,
        )
          .bind(reason, artifactId)
          .run();
      }

      deactivated++;
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
  }

  // Trim old artifact_checks (keep last 90 days)
  let checksTrimmed = 0;
  if (!dryRun) {
    const trim = await DB.prepare(`
      DELETE FROM artifact_checks 
      WHERE checked_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', '-90 days')
    `).run();
    checksTrimmed = trim.meta.changes;
  }

  return c.json({
    candidates: candidateCount,
    deactivated,
    blockedBySafetyRatio: false,
    byReason,
    checksTrimmed,
  });
});

export const POST = (context: APIContext) => app.fetch(context.request, context.locals.runtime.env);