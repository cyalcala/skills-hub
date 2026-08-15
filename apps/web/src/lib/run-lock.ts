// Cooperative run locks for pulse agents.
//
// Two overlapping workflow runs writing the same rows is the failure mode this
// prevents. GitHub Actions `concurrency` groups help but do not cover manual
// dispatch racing a scheduled run, or a re-run of an older commit.
//
// Semantics:
//   * Acquire is atomic — a single conditional UPSERT, never read-then-write.
//   * Locks carry a TTL so a crashed holder self-heals. A workflow that is
//     OOM-killed cannot wedge the pipeline until someone notices.
//   * Release is idempotent and holder-scoped: you cannot release someone
//     else's lock by accident.
//
// Contract: specs/SPEC-db.md

export interface LockResult {
  acquired: boolean;
  /** Set when `acquired` is false — who currently holds it. */
  heldBy?: string | null;
  /** Set when `acquired` is false — when the existing lock expires. */
  expiresAt?: string | null;
}

/** Default lock lifetime. Comfortably longer than a pulse, shorter than its cron gap. */
export const DEFAULT_TTL_SECONDS = 20 * 60;

export function isoPlusSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function toIso(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Try to take `name`.
 *
 * The UPSERT's WHERE clause is the whole trick: the row is overwritten only
 * when the existing lock has already expired. Concurrent callers therefore
 * serialize on SQLite's own write lock, and exactly one wins.
 */
export async function acquireLock(
  db: D1Database,
  name: string,
  holder: string,
  now: Date,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<LockResult> {
  const nowIso = toIso(now);
  const expiresAt = isoPlusSeconds(now, ttlSeconds);

  const result = await db
    .prepare(
      `INSERT INTO run_locks (name, acquired_at, expires_at, holder)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(name) DO UPDATE SET
         acquired_at = excluded.acquired_at,
         expires_at  = excluded.expires_at,
         holder      = excluded.holder
       WHERE run_locks.expires_at <= ?2`,
    )
    .bind(name, nowIso, expiresAt, holder)
    .run();

  if (result.meta.changes > 0) {
    return { acquired: true };
  }

  const existing = await db
    .prepare(`SELECT holder, expires_at FROM run_locks WHERE name = ?1`)
    .bind(name)
    .first<{ holder: string | null; expires_at: string }>();

  return {
    acquired: false,
    heldBy: existing?.holder ?? null,
    expiresAt: existing?.expires_at ?? null,
  };
}

/**
 * Release `name`, but only if `holder` still owns it.
 *
 * Holder-scoping matters: if run A's lock expired and run B took it, run A
 * finishing later must not delete B's lock out from under it.
 */
export async function releaseLock(
  db: D1Database,
  name: string,
  holder: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM run_locks WHERE name = ?1 AND holder = ?2`)
    .bind(name, holder)
    .run();
  return result.meta.changes > 0;
}

/** Pure helper: has this lock expired as of `now`? Exported for testing. */
export function isExpired(expiresAt: string, now: Date): boolean {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return true; // unparseable == reclaimable, fail open
  return expiry <= now.getTime();
}

/** Stable holder id for a workflow run, so logs tie back to a run URL. */
export function holderId(agent: string, runId: string | undefined): string {
  return `${agent}@${runId ?? "local"}`;
}
