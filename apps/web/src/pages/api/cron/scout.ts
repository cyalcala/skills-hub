import { Hono } from "hono";
import { type Context } from "hono";
import type { APIContext } from "astro";
import { isAuthorized } from "../../../lib/auth";
import { getDueSources, stampSourceRun, toIso } from "../../../lib/db";
import { acquireLock, releaseLock, holderId } from "../../../lib/run-lock";

const app = new Hono().basePath("/api/cron/scout");

// Lock name for the Scout run, so two overlapping workflow runs cannot both
// claim the same due sources. Released in a finally below.
const LOCK_NAME = "scout";

type ScoutBody = {
  limit?: number;
};

/**
 * POST /api/cron/scout — due-source selection.
 *
 * Returns only enabled sources whose last_run_at + cadence_hours is in the
 * past (or that have never run), then stamps last_run_at on each selected row.
 * Read-only apart from that stamp; the harvester CLI turns the returned rows
 * into fetches and POSTs the results to /api/ingest.
 *
 * Contract: specs/SPEC-ingest.md
 */
app.post("/", async (c: Context) => {
  // --- Authentication ---
  const proxySecret = c.env.PROXY_SECRET || c.env.CRON_SECRET;
  if (!isAuthorized(c.req.raw, proxySecret)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // --- Parse body ---
  let limit = 100;
  try {
    const body = (await c.req.json()) as ScoutBody;
    if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.floor(body.limit));
    }
  } catch {
    // Malformed/empty body: fall back to the default limit. Selection is
    // still safe — this endpoint never trusts request content for writes.
  }

  // --- Lock acquisition ---
  const now = new Date();
  const holder = holderId("scout", "local");
  const lockResult = await acquireLock(c.env.DB, LOCK_NAME, holder, now);

  if (!lockResult.acquired) {
    return c.json(
      {
        ok: false,
        heldBy: lockResult.heldBy,
        expiresAt: lockResult.expiresAt,
      },
      409,
    );
  }

  try {
    const dueSources = await getDueSources(c.env.DB, limit);

    // Stamp last_run_at for each selected source so the same sources are not
    // re-returned until their cadence elapses.
    await stampSourceRun(
      c.env.DB,
      dueSources.map((s) => s.id),
      toIso(now),
    );

    return c.json({
      ok: true,
      due: dueSources.length,
      sources: dueSources,
    });
  } catch (e) {
    // D1 unavailable or other runtime error
    return c.json({ error: "D1 unavailable" }, 503);
  } finally {
    // Always release the lock - holder is the agent that acquired it
    try {
      await releaseLock(c.env.DB, LOCK_NAME, holder);
    } catch {}
  }
});

export const POST = (context: APIContext) => app.fetch(context.request, context.locals.runtime.env);

export { app };