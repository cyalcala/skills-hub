# Master Execution Plan — Skills Hub

**Status:** Phase P0 complete (architecture + scaffold). P1 onward is open work.
**Owner:** `cyalcala`
**Repository:** `cyalcala/skills-hub`
**Last updated:** 2026-08-15

> This is the canonical plan. Any AI model or human picking up this project
> should read this file first, then [`HANDOFF-NEMOTRON.md`](HANDOFF-NEMOTRON.md)
> for execution mechanics, then the module spec for the work at hand.

---

## 1. What we are building

**Skills Hub** is a public, self-updating, self-researching directory of AI agent
capabilities — Claude Agent Skills, MCP servers, agent rule files, and
subagent/command packs — discovered continuously from public sources and ranked
by a deterministic, published quality rubric.

It is modeled structurally on `cyalcala/va-freelance-hub`, which proved the
pattern: GitHub Actions cron agents feeding an authenticated ingest API backed
by Cloudflare D1, with a static-fast Astro front end on Cloudflare Pages.

### Why this exists

The agent-skills ecosystem is growing faster than anyone can track by hand.
Skills are scattered across thousands of GitHub repos, a handful of registries,
and a long tail of awesome-lists. There is no neutral index that answers:

- What skills exist for *X*?
- Is this one maintained, or abandoned in 2024?
- Does it actually have valid frontmatter, a license, and a working link?

The directory answers those three questions and nothing else. That narrowness is
the product.

### The one-sentence differentiator

Every other list is a human-curated README that rots; this one re-verifies its
entire corpus on a schedule and publishes the evidence.

---

## 2. Non-negotiable principles

These constrain every downstream decision. Violating one is a spec change, not
an implementation detail.

1. **Index, never mirror.** Store metadata and link out. Do not re-host skill
   content. See [ADR-003](decisions/ADR-003-index-not-mirror.md).
2. **Deterministic before intelligent.** Every artifact gets a complete record
   from pure parsing. AI enrichment is an optional overlay that can fail without
   blocking the pipeline. See [ADR-002](decisions/ADR-002-deterministic-enrichment.md).
3. **The read path never depends on the write path.** A total harvest outage
   leaves the public site serving yesterday's data, not a 500.
4. **Source compliance is a requirement, not an assumption.** Public visibility
   is not permission. Honor `robots.txt`, rate limits, and API terms.
   See [DATA-POLICY.md](DATA-POLICY.md).
5. **Evidence over vibes.** Every pulse writes a `source_runs` row. Progress
   percentages cite a commit hash and a workflow run id.
6. **Green CI can hide source-level failure.** A workflow that exits 0 while
   every adapter returned zero rows is a failure. Thresholds are explicit.

---

## 3. Architecture

```text
                        PUBLIC SOURCES
   GitHub Search API · MCP registries · awesome-lists · RSS · sitemaps
                              │
                              ▼
              ┌───────────────────────────────┐
              │  GitHub Actions pulse agents  │   (packages/harvester)
              │  scout · curator · sentinel   │
              │  pruner · cartographer ·      │
              │  chronicler                   │
              └───────────────┬───────────────┘
                              │  authenticated POST (shared secret)
                              ▼
              ┌───────────────────────────────┐
              │  Astro API routes             │   apps/web/src/pages/api
              │  /api/ingest  /api/cron/*     │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Cloudflare D1 (SQLite)       │
              │  artifacts · sources ·        │
              │  source_runs · checks ·       │
              │  categories · run_locks       │
              └───────────────┬───────────────┘
                              │  read-only
                              ▼
              ┌───────────────────────────────┐
              │  Cloudflare Pages (Astro SSR) │
              │  public browse / search / SEO │
              └───────────────────────────────┘
```

### The six agents

Each is one GitHub Actions workflow on its own cron and its own concurrency
group. Named for what they do, mirroring the model repo's convention.

| Agent | Workflow | Cadence | Job |
|---|---|---|---|
| 🔭 **Scout** | `gha-scout-pulse.yml` | every 6h | Discover new artifacts from enabled sources; POST to `/api/ingest` |
| 📚 **Curator** | `gha-curator-pulse.yml` | daily | Re-parse and re-score artifacts whose source changed; assign categories |
| 🛡️ **Sentinel** | `gha-sentinel-pulse.yml` | daily | HTTP-check `source_url` for the oldest-checked slice; record latency and status |
| ✂️ **Pruner** | `gha-pruner-pulse.yml` | weekly | Deactivate artifacts that are gone, stale, or repeatedly failing, with a reason |
| 🗺️ **Cartographer** | `gha-cartographer-pulse.yml` | weekly | Rebuild the taxonomy and recount categories |
| 📜 **Chronicler** | `gha-chronicler-pulse.yml` | weekly | Commit `docs/source-health-latest.md` — the public evidence rollup |

Every agent takes a `run_lock` before writing and releases it after. A stuck
lock older than its TTL is reclaimable — see [`SPEC-db.md`](../specs/SPEC-db.md).

---

## 4. Percent-based roadmap

Weighted checkpoints, not vibes. A phase counts only when its verification
passes and the evidence is recorded in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

| Phase | Weight | Focus | Status |
|---|---:|---|---|
| **P0** | 8% | Architecture, specs, scaffold, handoff docs | ✅ Complete |
| **P1** | 12% | `db` — schema, migrations, query layer, run locks | ⬜ Open |
| **P2** | 12% | `ingest` — auth, validation, batch upsert, evidence | ⬜ Open |
| **P3** | 15% | `harvest` — first three adapters producing real rows | ⬜ Open |
| **P4** | 12% | `enrich` — deterministic rubric scoring end to end | ⬜ Open |
| **P5** | 10% | `verify` — Sentinel + Pruner closing the loop | ⬜ Open |
| **P6** | 18% | `web` — public surface, search, detail pages, SEO | ⬜ Open |
| **P7** | 8% | `pulse` — all six workflows green on schedule | ⬜ Open |
| **P8** | 5% | Launch — custom domain, sitemap, evidence rollup public | ⬜ Open |

**Definition of a completed phase:** tests pass, the build is clean, the
behavior is verified against a real runtime (not a mock), the phase's docs are
updated, and a workflow run id or commit hash is cited.

---

## 5. Phase detail

### P1 — `db` (12%)

Foundation. Everything else waits on the row shape.

- Author `apps/web/migrations/0000_init.sql` covering all six tables plus the
  FTS5 virtual table and its sync triggers.
- Indexes must be **ordering-aligned**: any column pair used in
  `WHERE ... ORDER BY ...` needs a composite index in that order. The model
  repo's audit found unaligned indexes were its top query cost.
- `src/lib/db.ts` exposes a typed accessor. No raw SQL outside `src/lib/`.
- `src/lib/run-lock.ts` — acquire/release/reclaim with TTL.

**Verify:** `wrangler d1 migrations apply DB --local` succeeds; `bun test tests/run-lock.test.ts` passes.

### P2 — `ingest` (12%)

- Constant-time shared-secret auth, lifted from the model repo's `auth.ts`
  (already scaffolded — it is correct, keep it).
- `ArtifactInput` validation. Reject the batch on a malformed row; never
  silently drop.
- **Batch upserts must chunk.** D1 caps SQL variables per statement; the model
  repo hit `too many SQL variables` in production. Chunk by variable count, not
  row count. See [`SPEC-ingest.md`](../specs/SPEC-ingest.md).
- Every call writes a `source_runs` row with discovered/accepted/rejected counts.

**Verify:** `bun test tests/ingest-batch.test.ts tests/auth.test.ts` passes,
including a >1000-row batch that exercises chunking.

### P3 — `harvest` (15%)

Three adapters first, then breadth. Start with the highest-signal, lowest-risk
sources:

1. `github-code-search` — finds `SKILL.md` files with valid frontmatter.
2. `mcp-registry` — the official MCP server registry.
3. `awesome-list` — parses curated lists into candidate repos.

Each adapter is a pure function: config in, `ArtifactInput[]` out. No network
calls in tests — fixtures only.

**Verify:** each adapter has a fixture test; a real Scout run inserts >0 rows
and the workflow log shows non-zero `accepted`.

### P4 — `enrich` (12%)

- Implement the rubric in [`QUALITY-RUBRIC.md`](QUALITY-RUBRIC.md) as a pure
  function `score(artifact) -> { score, breakdown }`.
- Store the breakdown as JSON so the site can show *why* something scored what
  it did. Opaque scores are not trustworthy.
- Optional AI pass behind a capability check: if no model binding, skip
  cleanly and log it. Never throw.

**Verify:** `bun test tests/quality.test.ts` covers each rubric dimension
independently plus a golden-file end-to-end case.

### P5 — `verify` (10%)

- Sentinel checks the N oldest-checked active artifacts per run, not everything.
- Distinguish transient (5xx, timeout) from terminal (404, 410) failures.
  Terminal deactivates immediately; transient needs three consecutive failures.
- Pruner sets `is_active = 0` with a specific `inactive_reason`. Never deletes.

**Verify:** `bun test tests/verify-attempt.test.ts`; a Sentinel run updates
`artifact_checks` and the count is visible in the workflow log.

### P6 — `web` (18%)

Largest phase. The model repo's audit is a gift here — do not repeat its bugs:

- **Paginate server-side from day one.** Its `/categories/tech` page shipped
  980 KB of HTML before pagination; the homepage hit 1.75 MB.
- Search via FTS5, not `LIKE '%...%'`.
- Every list route has an explicit empty state and an error boundary.
- JSON-LD on detail pages; `sitemap.xml` generated from D1.
- Outbound links go through `/api/click/[id]` for counting, with a safe-URL
  allowlist so the redirect cannot be used as an open proxy.

**Verify:** every route returns 200 with a seeded DB; no HTML document exceeds
150 KB; Lighthouse performance ≥ 90.

### P7 — `pulse` (8%)

- All six workflows on schedule, each with `concurrency` set and
  `permissions: contents: read` (except Chronicler, which needs write).
- Explicit failure thresholds as env vars, so a silent zero-row run is loud.

**Verify:** one full week with all six green and `source_runs` populated.

### P8 — Launch (5%)

Custom domain, `robots.txt`, sitemap submitted, evidence rollup published, README
badges live.

---

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub API rate limits throttle Scout | High | Authenticated requests (5000/h), conditional ETags, per-source cadence, resumable cursor in `sources.last_cursor` |
| D1 `too many SQL variables` on batch insert | High | Chunk by variable count; regression test with a >1000-row batch (this bit the model repo in production) |
| Silent zero-row harvest with green CI | High | `SOURCE_FAILURE_FAIL_THRESHOLD` + assert accepted > 0 across all sources; Chronicler publishes the rollup |
| Front-end payload bloat as corpus grows | Med | Server-side pagination from day one; HTML size assertion in CI |
| A source changes terms or blocks us | Med | Per-source `enabled` flag flips without a deploy; `DATA-POLICY.md` documents removal on request |
| Duplicate artifacts across sources | Med | `content_hash` over normalized identity fields + unique index on `source_url` |
| Quality score contested as unfair | Low | Rubric is published, deterministic, and the per-artifact breakdown is visible |
| Cloudflare local D1 auth error 7403 | Low | Known from the model repo — use workflow evidence for audits, or refresh `wrangler login` |

---

## 7. Open questions

Carried forward for the implementing model to resolve or escalate:

1. **Custom domain.** Not chosen. Default is `skills-hub.pages.dev`.
2. **Corpus ceiling.** At what artifact count does D1 (10 GB, but query-cost
   bound) stop being the right store? Estimate at 50k rows and revisit.
3. **De-dup across forks.** A popular skill forked 200 times should appear once,
   attributed to the upstream. Heuristic is specified but unproven at scale.
4. **AI enrichment provider.** Deferred by design. Workers AI is the intended
   first choice when it is turned on.

---

## 8. Where everything lives

| What | Where |
|---|---|
| This plan | `docs/MASTER_EXECUTION_PLAN.md` |
| Handoff for the implementing model | `docs/HANDOFF-NEMOTRON.md` |
| Progress + evidence | `docs/IMPLEMENTATION_STATUS.md` |
| Module contracts | `specs/SPEC-<module>.md` |
| Capability map | `specs/CAPABILITY-MAP.md` |
| Task queue | `tasks/todo.md` |
| Architecture decisions | `docs/decisions/ADR-*.md` |
| Cloudflare setup steps | `docs/RUNBOOK-CLOUDFLARE.md` |
| Quality rubric | `docs/QUALITY-RUBRIC.md` |
| Source inventory + compliance | `docs/SOURCES.md`, `docs/DATA-POLICY.md` |
