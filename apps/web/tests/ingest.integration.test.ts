import { describe, it, expect, afterAll } from "vitest";
import { createMigratedD1 } from "./helpers/d1";
import { app } from "../src/pages/api/ingest";
import { acquireLock } from "../src/lib/run-lock";

const harness = await createMigratedD1();
const db = harness.db;

afterAll(async () => {
  await harness.dispose();
});

type IngestResponse = {
  ok: boolean;
  inserted: number;
  attempted: number;
  accepted: number;
  rejected: number;
  status?: string;
  heldBy?: string;
  expiresAt?: string;
};

describe("POST /api/ingest", () => {
  it("returns 401 without auth header", async () => {
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "test", artifacts: [] }),
    });
    const res = await app.fetch(req, { DB: db });
    expect(res.status).toBe(401);
  });

  it("returns 401 with bad secret", async () => {
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({ agent: "test", artifacts: [] }),
    });
    const res = await app.fetch(req, { DB: db });
    expect(res.status).toBe(401);
  });

  it("returns 200 and inserts a new artifact", async () => {
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-secret",
      },
      body: JSON.stringify({
        agent: "test",
        artifacts: [
          {
            kind: "skill",
            name: "test-skill",
            summary: "a test skill",
            source_url: "https://github.com/test/test-skill",
            license: "MIT",
            tags: ["test"],
          },
        ],
      }),
    });
    const res = await app.fetch(req, {
      DB: db,
      PROXY_SECRET: "dev-secret",
    });
    const body = await res.json() as IngestResponse;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.inserted).toBe(1);
    expect(body.attempted).toBe(1);
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(0);
  });

  it("returns 200 with unchanged on re-post", async () => {
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-secret",
      },
      body: JSON.stringify({
        agent: "test",
        artifacts: [
          {
            kind: "skill",
            name: "test-skill",
            summary: "a test skill",
            source_url: "https://github.com/test/test-skill",
            license: "MIT",
            tags: ["test"],
          },
        ],
      }),
    });
    const res = await app.fetch(req, {
      DB: db,
      PROXY_SECRET: "dev-secret",
    });
    const body = await res.json() as IngestResponse;
    expect(res.status).toBe(200);
    expect(body.attempted).toBe(1);
    expect(body.inserted).toBe(0);
  });

  it("returns 400 for malformed body", async () => {
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-secret",
      },
      body: JSON.stringify({ agent: "test" }),
    });
    const res = await app.fetch(req, {
      DB: db,
      PROXY_SECRET: "dev-secret",
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when lock is held by another agent", async () => {
    const now = new Date();
    await acquireLock(db, "ingest", "other-agent", now);

    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-secret",
      },
      body: JSON.stringify({
        agent: "test-agent",
        artifacts: [
          {
            kind: "skill",
            name: "t",
            source_url: "https://github.com/a/c",
          },
        ],
      }),
    });
    const res = await app.fetch(req, {
      DB: db,
      PROXY_SECRET: "dev-secret",
    });
    const body = await res.json() as IngestResponse;
    expect(res.status).toBe(409);
    expect(body.status).toBe("failed");
  });
});