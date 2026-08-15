import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createMigratedD1 } from "./helpers/d1";
import { app } from "../src/pages/api/ingest";
import { chunkByVariableBudget, MAX_SQL_VARIABLES } from "../src/lib/ingest-batch";
import { releaseLock } from "../src/lib/run-lock";

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
  updated: number;
  unchanged: number;
  status?: string;
  heldBy?: string;
  expiresAt?: string;
  errors?: string[];
};

function makeArtifact(index: number) {
  return {
    kind: "skill" as const,
    name: `test-skill-${index}`,
    summary: `A test skill number ${index}`,
    source_url: `https://github.com/test/test-skill-${index}`,
    license: "MIT",
    tags: ["test", `batch-${index}`],
  };
}

async function postIngest(artifacts: ReturnType<typeof makeArtifact>[], agent = "batch-regression-test") {
  const req = new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer dev-secret",
    },
    body: JSON.stringify({ agent, artifacts }),
  });
  return app.fetch(req, { DB: db, PROXY_SECRET: "dev-secret" });
}

beforeAll(async () => {
  try {
    await releaseLock(db, "ingest", "batch-regression-test");
  } catch {}
});

describe("POST /api/ingest — batch regression (exceeds SQL variable limit)", () => {
  // 100 rows × 27 cols = 2700 variables > 900 limit → requires 4 chunks
  // This tests the variable-budget chunking path without the slowness of 500+ rows
  const TEST_BATCH_SIZE = 100;

  it("verifies chunking logic: 100 rows → 4 internal chunks", () => {
    const artifacts = Array.from({ length: TEST_BATCH_SIZE }, (_, i) => makeArtifact(i));
    const columnsPerRow = 27;
    const chunks = chunkByVariableBudget(artifacts, columnsPerRow, MAX_SQL_VARIABLES);
    // 100 rows / 33 per chunk = 4 chunks (33 + 33 + 33 + 1)
    expect(chunks.length).toBe(4);
    expect(chunks[0]!.length).toBe(33);
    expect(chunks[3]!.length).toBe(1);
    expect(chunks.flat().length).toBe(TEST_BATCH_SIZE);
  });

  it("inserts all rows, chunks internally without SQL variable error", async () => {
    const artifacts = Array.from({ length: TEST_BATCH_SIZE }, (_, i) => makeArtifact(i));
    const res = await postIngest(artifacts);
    expect(res.status).toBe(200);
    const body = await res.json() as IngestResponse;
    expect(body.ok).toBe(true);
    expect(body.attempted).toBe(TEST_BATCH_SIZE);
    expect(body.accepted).toBe(TEST_BATCH_SIZE);
    expect(body.rejected).toBe(0);
    expect(body.inserted).toBe(TEST_BATCH_SIZE);
    expect(body.updated).toBe(0);
    expect(body.unchanged).toBe(0);
  }, 60000);

  it("re-posting same batch yields all 'unchanged'", async () => {
    try { await releaseLock(db, "ingest", "batch-regression-test"); } catch {}
    const artifacts = Array.from({ length: TEST_BATCH_SIZE }, (_, i) => makeArtifact(i));
    const res = await postIngest(artifacts);
    expect(res.status).toBe(200);
    const body = await res.json() as IngestResponse;
    expect(body.unchanged).toBe(TEST_BATCH_SIZE);
    expect(body.inserted).toBe(0);
    expect(body.updated).toBe(0);
  }, 60000);

  it("partial update: 50 changed + 50 unchanged", async () => {
    try { await releaseLock(db, "ingest", "batch-regression-test"); } catch {}
    // Modify first 50 (change summary → different content_hash)
    const modified50 = Array.from({ length: 50 }, (_, i) => ({
      ...makeArtifact(i),
      summary: `UPDATED: ${makeArtifact(i).summary}`,
    }));
    let res = await postIngest(modified50);
    let body = await res.json() as IngestResponse;
    expect(body.updated).toBe(50);
    expect(body.unchanged).toBe(0);

    try { await releaseLock(db, "ingest", "batch-regression-test"); } catch {}
    // Re-post second 50 unchanged
    const unchanged50 = Array.from({ length: 50 }, (_, i) => makeArtifact(i + 50));
    res = await postIngest(unchanged50);
    body = await res.json() as IngestResponse;
    expect(body.unchanged).toBe(50);
    expect(body.updated).toBe(0);
  }, 60000);

  it("verifies no artifact was lost — count rows in DB", async () => {
    const { results } = await db
      .prepare("SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1")
      .all<{ count: number }>();
    expect(results?.[0]?.count).toBe(TEST_BATCH_SIZE);
  });

  it("verifies FTS index has all rows", async () => {
    const { results } = await db
      .prepare("SELECT COUNT(*) as count FROM artifacts_fts")
      .all<{ count: number }>();
    expect(results?.[0]?.count).toBe(TEST_BATCH_SIZE);
  });

  it("verifies source_runs has 4 rows for this agent (initial + re-post + partial update + partial re-post)", async () => {
    const { results } = await db
      .prepare("SELECT COUNT(*) as count FROM source_runs WHERE agent = 'batch-regression-test'")
      .all<{ count: number }>();
    expect(results?.[0]?.count).toBe(4);
  });
});

describe("chunkByVariableBudget — 1000-row scale verification (unit tests)", () => {
  it("1000 rows produces 31 chunks (33*30 + 10)", () => {
    const rows = new Array(1000).fill({});
    const chunks = chunkByVariableBudget(rows, 27, 900);
    expect(chunks.length).toBe(31);
    expect(chunks.flat().length).toBe(1000);
  });

  it("500 rows produces 16 chunks (33*15 + 5)", () => {
    const rows = new Array(500).fill({});
    const chunks = chunkByVariableBudget(rows, 27, 900);
    expect(chunks.length).toBe(16);
    expect(chunks.flat().length).toBe(500);
  });

  it("exact fit: 900 variables / 27 cols = 33 rows per chunk", () => {
    const rows = new Array(33).fill({});
    const chunks = chunkByVariableBudget(rows, 27, 900);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBe(33);
  });

  it("one over: 34 rows needs 2 chunks", () => {
    const rows = new Array(34).fill({});
    const chunks = chunkByVariableBudget(rows, 27, 900);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBe(33);
    expect(chunks[1]!.length).toBe(1);
  });

  it("empty array returns empty", () => {
    expect(chunkByVariableBudget([], 27, 900)).toEqual([]);
  });

  it("throws when single row exceeds budget", () => {
    expect(() => chunkByVariableBudget([{}], 1000, 900)).toThrow();
  });
});