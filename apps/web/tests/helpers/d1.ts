// Shared D1 integration-test harness.
//
// Boots a real local D1 database (Miniflare) with FTS5 and applies the
// migration so tests exercise the same surface as production — including the
// artifacts_fts triggers. Importing this from a vitest test is the only way an
// integration test may obtain a D1 handle in this repo.

import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(process.cwd(), "migrations", "0000_init.sql");

/**
 * The migration file uses `--> statement-breakpoint` separators and
 * `--` comment lines. This splits it into individual statements that D1 can
 * execute, preserving statements that themselves contain semicolons (e.g. the
 * FTS trigger bodies).
 */
export function splitMigrationStatements(raw: string): string[] {
  return raw
    .split(/-->\s*statement-breakpoint/)
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

export interface D1Harness {
  db: D1Database;
  dispose: () => Promise<void>;
}

/**
 * Create a fresh, migrated D1 database. The database is created fresh for
 * every call so tests never leak rows into each other.
 */
export async function createMigratedD1(dbName = "test-db"): Promise<D1Harness> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: `export default { async fetch() { return new Response("ok"); } };`,
      d1Databases: { DB: dbName },
    }),
  );

  const db = await mf.getD1Database("DB");
  const raw = readFileSync(MIGRATION, "utf8");
  for (const statement of splitMigrationStatements(raw)) {
    await db.prepare(statement).run();
  }

  return {
    db,
    dispose: () => mf.dispose(),
  };
}