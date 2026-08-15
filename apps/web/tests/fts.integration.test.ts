import { describe, it, expect, afterAll } from "vitest";
import { listAll, upsertArtifact } from "../src/lib/db";
import { computeContentHash } from "../src/lib/content-hash";
import { createMigratedD1 } from "./helpers/d1";

// These tests exercise the real D1 + FTS5 surface: the migration's
// artifacts_fts external-content table and its insert/delete triggers.

const harness = await createMigratedD1();
const db = harness.db;

afterAll(async () => {
  await harness.dispose();
});

describe("FTS5 integration", () => {
  it("finds a row via FTS after insert", async () => {
    const contentHash = await computeContentHash({
      kind: "skill",
      name: "test-skill",
      summary: "test summary",
      source_url: "https://example.com",
      license: "MIT",
    });

    await upsertArtifact(db, {
      kind: "skill",
      name: "test-skill",
      summary: "test summary",
      description: "test description",
      source_url: "https://example.com",
      repo_full_name: null,
      repo_host: null,
      homepage_url: null,
      license: "MIT",
      author: "Test User",
      tags: [],
      categories: [],
      install_target: [],
      version: null,
      stars: 0,
      forks: 0,
      quality_score: 0,
      quality_breakdown: "{}",
      content_hash: contentHash,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      source_updated_at: null,
      enriched_at: null,
      is_active: 1,
      inactive_reason: null,
    });

    const { results } = await db
      .prepare(`SELECT * FROM artifacts_fts WHERE name MATCH 'skill'`)
      .all();

    expect(results.length).toBeGreaterThan(0);
  });

  it("FTS search returns row after insert and stops after delete", async () => {
    const contentHash = await computeContentHash({
      kind: "skill",
      name: "test-skill-2",
      summary: "another summary",
      source_url: "https://example2.com",
      license: "Apache-2.0",
    });

    await upsertArtifact(db, {
      kind: "skill",
      name: "test-skill-2",
      summary: "another summary",
      description: "another description",
      source_url: "https://example2.com",
      repo_full_name: null,
      repo_host: null,
      homepage_url: null,
      license: "Apache-2.0",
      author: "Test User",
      tags: [],
      categories: [],
      install_target: [],
      version: null,
      stars: 0,
      forks: 0,
      quality_score: 0,
      quality_breakdown: "{}",
      content_hash: contentHash,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      source_updated_at: null,
      enriched_at: null,
      is_active: 1,
      inactive_reason: null,
    });

    // Insert should make it findable (term lives in `summary`, so match all columns)
    const { results: insertResults } = await db
      .prepare(`SELECT * FROM artifacts_fts WHERE artifacts_fts MATCH 'another'`)
      .all();
    expect(insertResults.length).toBeGreaterThan(0);

    // Delete should make it not findable
    // Note: This tests the trigger behavior - the FTS should be in sync
    await db.prepare(`DELETE FROM artifacts WHERE source_url = ?`).bind("https://example2.com").run();

    const { results: deleteResults } = await db
      .prepare(`SELECT * FROM artifacts_fts WHERE artifacts_fts MATCH 'another'`)
      .all();

    // After delete, FTS trigger should remove the entry
    expect(deleteResults.length).toBe(0);
  });

  it("lists an inserted row through the public query layer", async () => {
    await upsertArtifact(db, {
      kind: "mcp",
      name: "listable-mcp",
      summary: "a server",
      description: null,
      source_url: "https://example3.com",
      repo_full_name: null,
      repo_host: null,
      homepage_url: null,
      license: null,
      author: null,
      tags: [],
      categories: [],
      install_target: [],
      version: null,
      stars: 0,
      forks: 0,
      quality_score: 42,
      quality_breakdown: "{}",
      content_hash: "x",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      source_updated_at: null,
      enriched_at: null,
      is_active: 1,
      inactive_reason: null,
    });

    const rows = await listAll(db, 10, 0);
    expect(rows.some((r) => r.source_url === "https://example3.com")).toBe(true);
  });
});