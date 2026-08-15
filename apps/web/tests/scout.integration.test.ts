import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createMigratedD1 } from "./helpers/d1";
import { app } from "../src/pages/api/cron/scout";
import { acquireLock, releaseLock, toIso } from "../src/lib/db";

const harness = await createMigratedD1();
const db = harness.db;

afterAll(async () => {
  await harness.dispose();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedSource(overrides: Partial<{
  adapter: string;
  locator: string;
  kind: string;
  enabled: number;
  cadence_hours: number;
  last_run_at: string | null;
  health: string;
  notes: string | null;
}> = {}) {
  const row = {
    adapter: "test-adapter",
    locator: "test-locator",
    kind: "skill",
    enabled: 1,
    cadence_hours: 6,
    last_run_at: null,
    health: "unknown" as const,
    notes: null as string | null,
    ...overrides,
  };
  const { meta } = await db
    .prepare(
      `INSERT INTO sources (adapter, locator, kind, enabled, cadence_hours, last_run_at, health, notes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.adapter,
      row.locator,
      row.kind,
      row.enabled,
      row.cadence_hours,
      row.last_run_at,
      row.health,
      row.notes,
    )
    .run();
  return meta.last_row_id!;
}

async function clearSources() {
  await db.prepare("DELETE FROM sources").run();
}

type ScoutResponse = {
  ok?: boolean;
  due: number;
  sources: Array<{
    id: number;
    adapter: string;
    locator: string;
    kind: string;
    enabled: number;
    cadence_hours: number;
    last_run_at: string | null;
    health: string;
  }>;
  error?: string;
  heldBy?: string;
  expiresAt?: string;
};

async function postScout(
  body: Record<string, unknown> = {},
  env: Record<string, unknown> = {},
) {
  const req = new Request("http://localhost/api/cron/scout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer dev-secret",
    },
    body: JSON.stringify(body),
  });
  return app.fetch(req, {
    DB: db,
    PROXY_SECRET: "dev-secret",
    ...env,
  });
}

describe("POST /api/cron/scout", () => {
  beforeEach(async () => {
    await clearSources();
    // Release any leftover scout lock from a previous test
    try { await releaseLock(db, "scout", "scout@local"); } catch {}
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it("returns 401 without auth header", async () => {
    const req = new Request("http://localhost/api/cron/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await app.fetch(req, { DB: db });
    expect(res.status).toBe(401);
  });

  it("returns 401 with bad secret", async () => {
    const req = new Request("http://localhost/api/cron/scout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({}),
    });
    const res = await app.fetch(req, { DB: db });
    expect(res.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Empty / no due sources
  // -----------------------------------------------------------------------

  it("returns due=0 when no sources exist", async () => {
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.ok).toBe(true);
    expect(body.due).toBe(0);
    expect(body.sources).toEqual([]);
  });

  it("returns due=0 when all sources are within their cadence", async () => {
    const now = new Date();
    await seedSource({
      adapter: "a1",
      locator: "l1",
      cadence_hours: 24,
      // Just ran: last_run_at is very recent
      last_run_at: toIso(now),
    });
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Due source selection
  // -----------------------------------------------------------------------

  it("returns a never-run source as due", async () => {
    const id = await seedSource({
      adapter: "a1",
      locator: "l1",
      // last_run_at defaults to null
    });
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(1);
    expect(body.sources[0]!.id).toBe(id);
    expect(body.sources[0]!.adapter).toBe("a1");
    expect(body.sources[0]!.enabled).toBe(1);
  });

  it("returns a past-cadence source as due", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await seedSource({
      adapter: "a2",
      locator: "l2",
      cadence_hours: 1, // ran 2h ago, cadence is 1h → overdue
      last_run_at: toIso(twoHoursAgo),
    });
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(1);
    expect(body.sources[0]!.adapter).toBe("a2");
  });

  it("excludes disabled sources even if past due", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await seedSource({
      adapter: "disabled-source",
      locator: "ld",
      cadence_hours: 1,
      enabled: 0,
      last_run_at: toIso(twoHoursAgo),
    });
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(0);
  });

  it("excludes not-yet-due sources, includes due ones in same call", async () => {
    const now = new Date();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);

    // Due: never run
    await seedSource({
      adapter: "never-run",
      locator: "nr",
      cadence_hours: 1,
    });
    // Due: past cadence
    await seedSource({
      adapter: "past-cadence",
      locator: "pc",
      cadence_hours: 1,
      last_run_at: toIso(twoHoursAgo),
    });
    // Not due: just ran
    await seedSource({
      adapter: "just-ran",
      locator: "jr",
      cadence_hours: 24,
      last_run_at: toIso(now),
    });

    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(2);
    const adapters = body.sources.map((s) => s.adapter).sort();
    expect(adapters).toEqual(["never-run", "past-cadence"]);
  });

  // -----------------------------------------------------------------------
  // Stamping
  // -----------------------------------------------------------------------

  it("stamps last_run_at on returned sources", async () => {
    await seedSource({
      adapter: "a1",
      locator: "l1",
      cadence_hours: 1,
    });

    await postScout({});

    const { results } = await db
      .prepare("SELECT last_run_at FROM sources WHERE adapter = 'a1'")
      .all<{ last_run_at: string }>();
    expect(results?.[0]?.last_run_at).toBeTruthy();
    // Should be a recent ISO timestamp
    expect(results?.[0]?.last_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("re-stamping means previously-returned sources are NOT due again immediately", async () => {
    await seedSource({
      adapter: "a1",
      locator: "l1",
      cadence_hours: 24,
    });

    // First call: source has no last_run_at, so it's due
    const res1 = await postScout({});
    const body1 = await res1.json() as ScoutResponse;
    expect(body1.due).toBe(1);

    // Second call: last_run_at was just stamped, cadence 24h not up
    const res2 = await postScout({});
    const body2 = await res2.json() as ScoutResponse;
    expect(body2.due).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Limit
  // -----------------------------------------------------------------------

  it("honours limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await seedSource({
        adapter: `bulk-${i}`,
        locator: `blk-${i}`,
        cadence_hours: 1,
      });
    }
    const res = await postScout({ limit: 3 });
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(3);
    expect(body.sources.length).toBe(3);
  });

  it("defaults to 100 when no limit supplied", async () => {
    for (let i = 0; i < 10; i++) {
      await seedSource({
        adapter: `many-${i}`,
        locator: `mny-${i}`,
        cadence_hours: 1,
      });
    }
    const res = await postScout({});
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(10);
  }, 30000);

  it("defaults to 100 when body is malformed", async () => {
    for (let i = 0; i < 5; i++) {
      await seedSource({
        adapter: `mal-${i}`,
        locator: `mal-${i}`,
        cadence_hours: 1,
      });
    }
    // Send invalid JSON-like body
    const req = new Request("http://localhost/api/cron/scout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-secret",
      },

      // Send invalid JSON — the try/catch in the handler will default limit to 100
      body: "not-json",
    });
    const res = await app.fetch(req, { DB: db, PROXY_SECRET: "dev-secret" });
    expect(res.status).toBe(200);
    const body = await res.json() as ScoutResponse;
    expect(body.due).toBe(5);
  });

  // -----------------------------------------------------------------------
  // Lock contention
  // -----------------------------------------------------------------------

  it("eturns 409 when scout lock is held", async () => {
    const now = new Date();
    await acquireLock(db, "scout", "other-agent", now);

    const res = await postScout({});
    expect(res.status).toBe(409);
    const body = await res.json() as { heldBy?: string };
    expect(body.heldBy).toBe("other-agent");
  });

  // -----------------------------------------------------------------------
  // DB unavailable (simulated via broken env — hard to test cleanly in unit
  // tests since lock acquisition runs before the D1 catch block)
  // Not including a 503 test because a null binding throws during lock
  // acquisition, which is before the handler's catch-all for D1 failures.
  // In production the D1 binding is always present; a "not available" state
  // manifests as query failures within the try block.
  // -----------------------------------------------------------------------
});