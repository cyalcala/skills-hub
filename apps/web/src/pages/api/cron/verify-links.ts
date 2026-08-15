import { Hono } from "hono";
import { type Context } from "hono";
import { politeFetch } from "../../packages/harvester/src/lib/http";
import { classifyObservation, deriveInactiveReason } from "../../src/lib/verify-attempt";
import { getInactiveReasonFromChecks, checkSafetyRatio } from "../../src/lib/inactive-reason";
import { db } from "../../src/lib/db";
import { listUnenriched } from "../../src/lib/db";
import { ARTIFACT_KINDS } from "../../packages/harvester/src/artifact-schema";

const app = new Hono();

type VerifyBody = {
  batchSize?: number;
};

/** POST /api/cron/verify-links */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as VerifyBody;
  const batchSize = body.batchSize ?? 300;
  const now = new Date();

  // Select the N oldest-checked active artifacts per run
  // These are artifacts that have been checked but may have changed status
  const dueArtifacts = await db.prepare(`
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

  const results: Array<{
    artifact_id: number;
    http_status: number;
    latency_ms?: number;
    verdict: "ok" | "terminal" | "transient";
    reason?: string;
  }> = [];

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

    results.push({
      artifact_id: row.artifact_id,
      http_status: row.http_status,
      latency_ms: row.latency_ms,
      verdict,
      reason: row.reason,
    });

    if (verdict === "ok") {
      okCount++;
    } else if (verdict === "terminal") {
      terminalCount++;

      // Derive inactive reason and deactivate
      const lastSeenAtDaysOld = row.last_seen_at
        ? Math.floor((Date.now() - new Date(row.last_seen_at).getTime()) / 86400000)
        : null;

      const { reason: inactiveReason, isTerminal } = deriveInactiveReason(
        verdict,
        1, // This is the first observation in this run
        lastSeenAtDaysOld
      );

      // Deactivate the artifact
      await db.prepare(
        `UPDATE artifacts SET is_active = 0, inactive_reason = ?1 WHERE id = ?2`,
      )
        .bind(inactiveReason, row.artifact_id)
        .run();

      // Record the check result
      await db.prepare(
        `INSERT INTO artifact_checks (artifact_id, checked_at, http_status, ok, latency_ms, reason)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?2, 0, ?3, ?4)`,
      )
        .bind(row.artifact_id, row.http_status, row.latency_ms, row.reason)
        .run();
    } else if (verdict === "transient") {
      transientCount++;

      // Record the check result
      await db.prepare(
        `INSERT INTO artifact_checks (artifact_id, checked_at, http_status, ok, latency_ms, reason)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?2, 0, ?3, ?4)`,
      )
        .bind(row.artifact_id, row.http_status, row.latency_ms, row.reason)
        .run();
    }
  }

  // Check safety ratio - if too many candidates, block the prune
  const liveCorpusResult = await db.prepare(
    `SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1`
  ).first();

  const liveCorpusSize = liveCorpusResult?.count ?? 0;
  const totalChecked = results.length;
  const candidatesForDeactivation = results.filter(
    r => r.verdict === "terminal" || (r.verdict === "transient" && /* would need consecutive tracking */ true)
  ).length;

  const { blocked, ratioPct } = checkSafetyRatio(
    candidatesForDeactivation,
    liveCorpusSize
  );

  if (blocked) {
    return c.json({
      checked: totalChecked,
      ok: okCount,
      failed: transientCount + terminalCount,
      blockedBySafetyRatio: true,
    });
  }

  return c.json({
    checked: totalChecked,
    ok: okCount,
    failed: transientCount + terminalCount,
    blockedBySafetyRatio: false,
  });
});

export default app;