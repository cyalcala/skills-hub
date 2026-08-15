import { Hono } from "hono";
import { type Context } from "hono";

const app = new Hono();

type ScoutBody = {
  limit?: number;
};

/** POST /api/cron/scout - Due source selection */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as ScoutBody;
  const limit = body.limit ?? 100;
  const now = new Date();
  const DB = c.env.DB as D1Database;

  // Select sources due for a run: enabled sources whose last_run_at + cadence_hours
  // is before now (or have never run, i.e. last_run_at is null).
  // In SQLite, we add cadence_hours to last_run_at and compare with current time.
  const dueSources = await DB.prepare(`
    SELECT id, adapter, locator, kind, enabled, cadence_hours,
           last_run_at, last_cursor, consecutive_failures, health, notes,
           created_at
    FROM sources
    WHERE enabled = 1
    AND (last_run_at IS NULL OR datetime(last_run_at, '+' || cadence_hours || ' hours') <= datetime('now'))
    ORDER BY last_run_at ASC
    LIMIT ?1
  `).bind(limit).all<{
    id: number;
    adapter: string;
    locator: string;
    kind: string;
    enabled: number;
    cadence_hours: number;
    last_run_at: string | null;
    last_cursor: string | null;
    consecutive_failures: number;
    health: string;
    notes: string | null;
    created_at: string;
  }>();

  // Stamp last_run_at for each selected source
  for (const source of dueSources?.results || []) {
    await DB.prepare(
      `UPDATE sources SET last_run_at = ?1 WHERE id = ?2`,
    )
      .bind(now.toISOString(), source.id)
      .run();
  }

  return c.json({
    due: dueSources?.results?.length ?? 0,
    sources: dueSources?.results || [],
  });
});

export default app;