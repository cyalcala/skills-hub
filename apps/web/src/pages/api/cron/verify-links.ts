import { Hono } from "hono";
import { type Context } from "hono";
import { classifyObservation, deriveInactiveReason } from "../../../lib/verify-attempt";
import { checkSafetyRatio } from "../../../lib/inactive-reason";

const app = new Hono();

type VerifyBody = {
  batchSize?: number;
};

/** POST /api/cron/verify-links */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as VerifyBody;
  const batchSize = body.batchSize ?? 300;
  const DB = c.env.DB as D1Database;

  // Select the N oldest-checked active artifacts per run
  const dueArtifacts = await DB.prepare(`
    SELECT ac.artifact_id, ac.http_status, ac.latency_ms, ac.reason, ac.checked_at,
           a.last_seen_at, a.is_active, a.source_url
    FROM artifact_checks ac
    JOIN artifacts a ON ac.artifact_id = a.id
    WHERE a.is_active = 1
    ORDER BY ac.checked_at ASC
    LIMIT ?1
  `).bind(batchSize).all<{
    artifact_id: number;
    http_status: number;
    latency_ms?: number;
    reason?: string;
    checked_at: string;
    last_seen_at: string | null;
    is_active: number;
    source_url: string;
  }>();

  let terminalCount = 0;
  let transientCount = 0;
  let okCount = 0;

  for (const row of dueArtifacts?.results || []) {
    // Classify the observation
    const verdict = classifyObservation({
      http_status: row.http_status,
      latency_ms: row.latency_ms,
      reason: row.reason,
    });

    if (verdict === "ok") {
      okCount++;
    } else if (verdict === "terminal") {
      terminalCount++;

      // Record the check result
      await DB.prepare(
        `INSERT INTO artifact_checks (artifact_id, checked_at, http_status, ok, latency_ms, reason)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?2, 0, ?3, ?4)`,
      )
        .bind(row.artifact_id, row.http_status, row.latency_ms, row.reason)
        .run();
    } else if (verdict === "transient") {
      transientCount++;

      await DB.prepare(
        `INSERT INTO artifact_checks (artifact_id, checked_at, http_status, ok, latency_ms, reason)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?2, 0, ?3, ?4)`,
      )
        .bind(row.artifact_id, row.http_status, row.latency_ms, row.reason)
        .run();
    }
  }

  // Check safety ratio - if too many candidates, block the prune
  const liveCorpusResult = await DB.prepare(
    `SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1`
  ).first<{ count: number }>();

  const liveCorpusSize = liveCorpusResult?.count ?? 0;
  const candidatesForDeactivation = terminalCount;

  const { blocked } = checkSafetyRatio(
    candidatesForDeactivation,
    liveCorpusSize,
  );

  if (blocked) {
    return c.json({
      checked: dueArtifacts?.results?.length ?? 0,
      ok: okCount,
      failed: transientCount + terminalCount,
      blockedBySafetyRatio: true,
    });
  }

  return c.json({
    checked: dueArtifacts?.results?.length ?? 0,
    ok: okCount,
    failed: transientCount + terminalCount,
    blockedBySafetyRatio: false,
  });
});

export default app;