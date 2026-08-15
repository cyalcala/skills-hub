# Spec: `db`

**Module id:** `db` · **Depends on:** — · **Phase:** P1 (12%)

## Objective

Own the persistence layer: the D1 schema, its migrations, a typed query surface,
and the run-lock primitive that keeps concurrent pulse agents from corrupting
each other. Every other module reads and writes through this module. No raw SQL
exists outside `apps/web/src/lib/`.

Success looks like: a fresh clone can run one command, get a local D1 with the
full schema, and every other module's tests can seed against it.

## Tech Stack

- Cloudflare D1 (SQLite-compatible), accessed via the Workers binding `DB`
- Migrations as plain `.sql` files under `apps/web/migrations/`, applied with
  `wrangler d1 migrations apply`
- No ORM. Hand-written SQL in `src/lib/`, typed by hand-written interfaces.
  (The model repo carries `drizzle-orm`; we deliberately do not — the query set
  is small and explicit SQL makes the index alignment auditable.)

## Commands

```bash
# apply migrations locally
cd apps/web && npx wrangler d1 migrations apply DB --local

# apply to production
cd apps/web && npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc

# open a local shell
cd apps/web && npx wrangler d1 execute DB --local --command "SELECT count(*) FROM artifacts;"

# tests
cd apps/web && npx vitest run tests/run-lock.test.ts
```

## Project Structure

```
apps/web/migrations/0000_init.sql   → full schema, the only migration at P1
apps/web/src/lib/db.ts              → binding accessor + row types
apps/web/src/lib/run-lock.ts        → acquire / release / reclaim
apps/web/src/lib/public-query.ts    → read queries used by the web module
apps/web/src/lib/time.ts            → ISO-8601 normalization helpers
apps/web/tests/run-lock.test.ts     → lock semantics incl. TTL reclaim
```

## The row shapes

### `artifacts` — the core unit

One row per discovered capability. `kind` discriminates the four indexed types.

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | autoincrement |
| `kind` | text NOT NULL | `skill` \| `mcp` \| `ruleset` \| `subagent` \| `command` |
| `name` | text NOT NULL | Display name, from frontmatter `name` or repo name |
| `slug` | text NOT NULL UNIQUE | URL-safe, stable, derived once and never regenerated |
| `summary` | text | One line, from frontmatter `description`, truncated at 300 |
| `description` | text | Longer body, README-derived, capped at 4000 |
| `source_url` | text NOT NULL UNIQUE | Canonical public URL. The dedupe key. |
| `repo_full_name` | text | `owner/repo` when the source is a git host |
| `repo_host` | text | `github` \| `gitlab` \| `other` |
| `homepage_url` | text | Optional project site |
| `license` | text | SPDX id, or `NOASSERTION` |
| `author` | text | Owner/org handle |
| `tags` | text DEFAULT `'[]'` | JSON array |
| `categories` | text DEFAULT `'[]'` | JSON array of category slugs |
| `install_target` | text DEFAULT `'[]'` | JSON array: `claude-code`, `cursor`, `opencode`, … |
| `version` | text | If declared |
| `stars` | integer DEFAULT 0 | Snapshot at last enrich |
| `forks` | integer DEFAULT 0 | |
| `quality_score` | integer DEFAULT 0 | 0–100, from the rubric |
| `quality_breakdown` | text DEFAULT `'{}'` | JSON, per-dimension. Never opaque. |
| `content_hash` | text NOT NULL | Change detection — see below |
| `first_seen_at` | text NOT NULL | ISO-8601 UTC, set once |
| `last_seen_at` | text NOT NULL | Updated every time a harvest re-observes it |
| `source_updated_at` | text | Upstream's own last-modified |
| `enriched_at` | text | Last successful enrich |
| `is_active` | integer NOT NULL DEFAULT 1 | |
| `inactive_reason` | text | Required whenever `is_active = 0` |

**`content_hash` is computed over normalized identity fields only** —
`kind`, `name`, `summary`, `source_url`, `license`, sorted `tags`. Not over
stars or timestamps, which churn constantly. If the hash is unchanged, the
upsert touches `last_seen_at` and nothing else. This is what keeps the Curator
cheap.

### `sources` — where we look

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `adapter` | text NOT NULL | Adapter module name, e.g. `github-code-search` |
| `locator` | text NOT NULL | Query string, URL, or registry endpoint |
| `kind` | text NOT NULL | Which artifact kind this source yields |
| `enabled` | integer NOT NULL DEFAULT 1 | **Flips without a deploy.** Compliance kill-switch. |
| `cadence_hours` | integer DEFAULT 6 | |
| `last_run_at` | text | |
| `last_cursor` | text | Resumable pagination state |
| `consecutive_failures` | integer DEFAULT 0 | |
| `health` | text DEFAULT `'unknown'` | `healthy` \| `degraded` \| `failing` \| `unknown` |
| `notes` | text | Compliance notes, terms links |

UNIQUE on (`adapter`, `locator`).

### `source_runs` — evidence

Append-only. This table is why we can say "green CI hid a failure" and prove it.

`id`, `source_id`, `agent`, `started_at`, `finished_at`, `status`
(`ok`\|`partial`\|`failed`), `discovered`, `accepted`, `rejected`,
`errors` (JSON array, capped at 20 entries).

### `artifact_checks` — verify history

`id`, `artifact_id`, `checked_at`, `http_status`, `ok` (integer),
`latency_ms`, `reason`.

Retain 90 days; the Pruner trims older rows.

### `categories` — taxonomy

`id`, `slug` UNIQUE, `label`, `kind`, `description`, `artifact_count`.
Recounted by the Cartographer, never incremented ad hoc (drift is guaranteed
otherwise).

### `run_locks` — concurrency

`name` TEXT PRIMARY KEY, `acquired_at`, `expires_at`, `holder`.

### `clicks` — outbound counting

`id`, `artifact_id`, `clicked_at`, `referer_host`. No IP, no user agent, no
cookies. See [DATA-POLICY.md](../docs/DATA-POLICY.md).

### `artifacts_fts` — search

FTS5 virtual table over (`name`, `summary`, `description`, `tags`), with
`content='artifacts'` and `content_rowid='id'`, kept in sync by AFTER
INSERT/UPDATE/DELETE triggers. Do not hand-maintain it in application code.

## Index alignment — the rule that matters

The model repo's audit found its hot queries were scanning because indexes were
declared on the filter column but not aligned with the sort. **Every index must
match its query's `WHERE` + `ORDER BY` in that order.**

Required at P1:

```sql
CREATE INDEX idx_artifacts_active_kind_score
  ON artifacts (is_active, kind, quality_score DESC);
CREATE INDEX idx_artifacts_active_seen
  ON artifacts (is_active, last_seen_at DESC);
CREATE INDEX idx_artifacts_check_queue
  ON artifacts (is_active, enriched_at);
CREATE INDEX idx_checks_artifact_time
  ON artifact_checks (artifact_id, checked_at DESC);
CREATE INDEX idx_runs_source_time
  ON source_runs (source_id, started_at DESC);
```

Adding a query that sorts differently means adding an index, or changing the
sort. Do not ship an unaligned hot query.

## Code Style

Explicit SQL, named bind params, one exported function per query. Row types are
hand-written and live next to the query.

```ts
export interface ArtifactRow {
  id: number;
  kind: ArtifactKind;
  name: string;
  slug: string;
  summary: string | null;
  quality_score: number;
  is_active: number; // SQLite has no boolean; 0 | 1
}

/** Active artifacts of one kind, best-scored first. Index-aligned. */
export async function listByKind(
  db: D1Database,
  kind: ArtifactKind,
  limit: number,
  offset: number,
): Promise<ArtifactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, slug, summary, quality_score, is_active
         FROM artifacts
        WHERE is_active = 1 AND kind = ?1
        ORDER BY quality_score DESC
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(kind, limit, offset)
    .all<ArtifactRow>();
  return results ?? [];
}
```

## Testing Strategy

Vitest, tests in `apps/web/tests/`. The `db` module's own tests cover pure
logic — lock TTL arithmetic, time normalization, query-string construction —
against an in-memory fake. Queries that must touch real SQLite are exercised in
integration tests using `wrangler d1 --local`.

Coverage expectation: 100% of `run-lock.ts` branches. Lock bugs are silent and
catastrophic.

## Boundaries

- **Always:** normalize every timestamp to ISO-8601 UTC on write; use named bind
  params; add the aligned index in the same migration as the query that needs it.
- **Ask first:** any schema change after P2 ships (it forces a migration against
  live data); adding an ORM; changing the `content_hash` input set (it
  invalidates the whole corpus).
- **Never:** interpolate values into SQL strings; delete artifact rows
  (deactivate with a reason instead); write raw SQL outside `src/lib/`.

## Success Criteria

- [ ] `wrangler d1 migrations apply DB --local` succeeds from a clean state
- [ ] All six tables plus `artifacts_fts` and its three triggers exist
- [ ] Every index in the list above is present
- [ ] `run-lock.test.ts` passes, covering acquire, contended acquire, release,
      and TTL reclaim of an expired lock
- [ ] Inserting a row and updating it via a second insert with the same
      `source_url` updates rather than duplicating
- [ ] An FTS query returns the row after insert, and stops returning it after
      delete (triggers verified, not assumed)

## Open Questions

- Retention on `source_runs`: unbounded append will grow. 90 days like
  `artifact_checks`, or keep forever as the evidence trail? Leaning: keep 1 year,
  then roll up to monthly aggregates.
