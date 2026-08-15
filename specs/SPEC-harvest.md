# Spec: `harvest`

**Module id:** `harvest` · **Depends on:** `ingest` · **Phase:** P3 (15%)

## Objective

Discover artifacts from public sources and hand them to `ingest` as valid
`ArtifactInput[]`. This is the discovery loop — the thing that makes the
directory self-updating rather than a snapshot.

## The adapter contract

**Every adapter is a pure function of its inputs.** Fetching is injected, so
adapters are testable against fixtures with zero network.

```ts
export interface AdapterContext {
  /** Injected fetch. Tests pass a fixture-backed stub. */
  fetch: typeof globalThis.fetch;
  /** Resumable pagination state from sources.last_cursor. */
  cursor: string | null;
  /** Hard ceiling on results this run. Respect it. */
  limit: number;
  logger: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
}

export interface AdapterResult {
  artifacts: ArtifactInput[];
  /** Persisted to sources.last_cursor for the next run. Null = start over. */
  nextCursor: string | null;
  /** Non-fatal problems. Fatal ones throw. */
  warnings: string[];
}

export interface Adapter {
  readonly name: string;
  readonly kind: ArtifactKind;
  /** Documented compliance basis — see docs/DATA-POLICY.md. Required. */
  readonly termsNote: string;
  run(locator: string, ctx: AdapterContext): Promise<AdapterResult>;
}
```

An adapter that cannot state its `termsNote` does not ship.

## Adapters for P3

Build these three first, in this order. Breadth comes after the loop closes.

### 1. `github-code-search`

Finds `SKILL.md` files with valid frontmatter via the GitHub code search API.

- **Auth required.** Unauthenticated is 60 req/h and code search needs a token.
- Cursor = page number plus the query hash, so a query change resets cleanly.
- Parse YAML frontmatter for `name` and `description`. **Frontmatter missing or
  unparseable is not a rejection** — emit the artifact with
  `has_valid_frontmatter: false` and let the rubric score it down. Deciding
  quality is the Curator's job, not the Scout's.
- `source_url` = the repo-relative permalink at the default branch, never a
  commit SHA (SHAs churn and break dedupe).

### 2. `mcp-registry`

The official MCP server registry. Structured JSON, generous shape, low risk.
Cursor = the registry's own pagination token.

### 3. `awesome-list`

Parses a curated markdown list into candidate repos. Noisiest of the three.

- Extract only links under a heading, ignoring badges and the ToC.
- Emit `kind` from the list's configured kind, not guessed per-row.
- Cap at 500 per list; a runaway list must not flood a single batch.

## Rate limiting and politeness

Non-negotiable, per [`../docs/DATA-POLICY.md`](../docs/DATA-POLICY.md):

- Send a descriptive `User-Agent` identifying the project with a contact URL.
- Honor `Retry-After` on 429 and 503. Back off exponentially with jitter.
- Cap concurrency at **4** in-flight requests per host.
- Use conditional requests (`ETag` / `If-Modified-Since`) wherever supported —
  it saves rate budget and is the polite default.
- Check `robots.txt` before any non-API HTML fetch. Cache it per host per run.
- **Never** work around a block, a CAPTCHA, or a rate limit. A blocked source
  gets `enabled = 0` and a note, and we move on.

## The CLI

```bash
npm run harvest --workspace @skills-hub/harvester -- \
  --agent scout [--adapter <name>] [--dry-run] [--limit 500] \
  --report scout-report.json
```

The report shape is the contract with `gha-scout-pulse.yml`:

```json
{
  "agent": "scout",
  "startedAt": "2026-08-15T00:00:00Z",
  "finishedAt": "2026-08-15T00:04:12Z",
  "totals": { "discovered": 812, "accepted": 790, "rejected": 22, "failedSources": 0 },
  "sources": [
    { "adapter": "github-code-search", "locator": "…", "discovered": 500,
      "accepted": 494, "rejected": 6, "status": "ok", "warnings": [] }
  ]
}
```

Changing this shape means changing the workflow's `jq` expressions. Do both, or
the pulse silently evaluates missing fields as zero and fails.

## Project Structure

```
packages/harvester/src/cli.ts                     → arg parsing, orchestration
packages/harvester/src/registry.ts                → adapter registry
packages/harvester/src/lib/http.ts                → polite fetch: UA, backoff, concurrency
packages/harvester/src/lib/robots.ts              → robots.txt parse + cache
packages/harvester/src/lib/frontmatter.ts         → YAML frontmatter parsing
packages/harvester/src/adapters/github-code-search.ts
packages/harvester/src/adapters/mcp-registry.ts
packages/harvester/src/adapters/awesome-list.ts
packages/harvester/tests/fixtures/               → recorded responses, committed
packages/harvester/tests/*.test.ts
```

## Testing Strategy

**No network in tests, ever.** Every adapter test injects a fetch stub backed by
a committed fixture. Record fixtures once from a real response, trim them, and
commit them — a test that hits the network is a test that fails on a plane and
in CI when a source has an outage.

Required per adapter:
- Happy path produces valid `ArtifactInput[]` (assert with `validateIngestBody`)
- Pagination advances the cursor, and a null cursor starts over
- A malformed upstream row produces a warning, not a crash
- 429 triggers backoff rather than a tight retry loop
- The `limit` ceiling is respected

## Boundaries

- **Always:** identify the crawler in the UA; honor `robots.txt` and
  `Retry-After`; validate output against `validateIngestBody` before POSTing;
  record a `termsNote`.
- **Ask first:** adding a source that requires an account or paid API; anything
  scraping rendered HTML rather than an API or feed.
- **Never:** bypass a rate limit, block, or CAPTCHA; scrape a source that
  disallows it; hardcode a token; hit the network in a test.

## Success Criteria

- [ ] All three adapters implemented with fixture tests passing
- [ ] A real Scout run inserts >0 rows and reports non-zero `accepted`
- [ ] Re-running immediately reports mostly `unchanged` (dedupe works)
- [ ] Cursor persists — the second run picks up where the first stopped
- [ ] A deliberately broken adapter fails only its own source, not the run
- [ ] Zero network calls in the test suite

## Open Questions

- **Fork de-duplication.** A popular skill forked 200 times should appear once,
  attributed upstream. Heuristic: when `repo_full_name` differs but the
  `content_hash` matches an existing artifact, prefer the one with the earlier
  `first_seen_at` and higher stars. Unproven at scale — revisit at P3 exit.
