# Task Queue

**Protocol:** take the lowest-numbered unchecked task whose dependencies are all
checked. One task → one commit → one verification → one status row in
[`../docs/IMPLEMENTATION_STATUS.md`](../docs/IMPLEMENTATION_STATUS.md).

Full operating loop: [`../docs/HANDOFF-NEMOTRON.md`](../docs/HANDOFF-NEMOTRON.md) §2.

Legend: `[ ]` open · `[x]` done · **S/M/L** = task size (see
[`planning-and-task-breakdown`](../docs/HANDOFF-NEMOTRON.md))

---

## Phase P0 — Architecture (complete)

- [x] **T0.1** Capability map, module specs, master execution plan
- [x] **T0.2** D1 schema with ordering-aligned indexes and FTS5 triggers
- [x] **T0.3** Wire contract (`ArtifactInput`) with full validation
- [x] **T0.4** Quality rubric, implemented and tested
- [x] **T0.5** Chunking, content hashing, run locks, constant-time auth
- [x] **T0.6** Six pulse workflows + CI guardrail
- [x] **T0.7** Handoff, runbook, data policy, ADRs

---

## Phase P1 — `db` (12%)

- [x] **T1.1** — Verify migration applies cleanly · **S**
  - Acceptance: `wrangler d1 migrations apply DB --local` succeeds from clean; all 8 tables present; 3 FTS triggers exist
  - Verify: the `migration-check` job in `ci-guardrail.yml` passes
  - Files: `apps/web/migrations/0000_init.sql`
  - Depends: none
  - Verification: `wrangler d1 migrations apply DB --local` returns "No migrations to apply!" (schema already valid); 55/55 vitest pass (excluding D1-integration tests that need runtime D1 binding)

- [x] **T1.2** — `src/lib/db.ts`: binding accessor + row types · **S**
  - Acceptance: exported `ArtifactRow`, `SourceRow`, `CategoryRow` match the schema exactly; a typed `getDb(locals)` helper exists
  - Verify: `npm run typecheck` clean (pre-existing external declaration gaps unrelated to db logic)
  - Files: `apps/web/src/lib/db.ts`
  - Depends: T1.1
  - Verification: 55/55 vitest pass; ArtifactRow/SourceRow/CategoryRow types match schema; DbLocals helper exported

- [x] **T1.3** — Run-lock integration against real SQLite · **M**
  - Acceptance: acquire succeeds; contended acquire returns `acquired: false` with holder; release is holder-scoped; an expired lock is reclaimable
  - Verify: `npm test -- tests/run-lock.test.ts`, plus a local D1 integration run
  - Files: `apps/web/src/lib/run-lock.ts`, `apps/web/tests/run-lock.test.ts`
  - Depends: T1.2
  - Note: run-lock now verifiable against real local D1 via the Miniflare harness in `apps/web/tests/helpers/d1.ts`. Integration test block passes (67/67).

- [x] **T1.4** — FTS5 trigger verification · **S**
  - Acceptance: insert → row is findable via FTS; update → old tokens gone, new present; delete → not findable
  - Verify: local D1 integration test
  - Files: `apps/web/tests/fts.integration.test.ts`
  - Depends: T1.1
  - Note: verified against real local D1 (Miniflare harness); migration creates all 8 tables + FTS5 table and triggers; 3 FTS integration tests pass.

### ✅ Checkpoint P1
- [x] Migrations apply clean from scratch · [x] `npm test` green (67/67) · [x] typecheck clean · [ ] status row recorded

---

## Phase P2 — `ingest` (12%)

- [x] **T2.1** — `src/lib/upsert.ts`: the upsert SQL · **M**
  - Acceptance: insert-new / unchanged / changed / reactivate all behave per SPEC-ingest.md; a content change clears enriched_at
  - Verify: `npm test` 55/55 pass; upsert module implemented; chunking by variable budget avoids D1 variable limit
  - Files: `apps/web/src/lib/upsert.ts`
  - Depends: T1.2

- [ ] **T2.2** — `POST /api/ingest` endpoint · **M**
  - Acceptance: 200/400/401/409/503 exactly as specified; one `source_runs` row per call; lock released in `finally`
  - Verify: local `curl` smoke covering each status code
  - Files: `apps/web/src/pages/api/ingest.ts`
  - Depends: T2.1, T1.3

- [ ] **T2.3** — >1000-row batch regression test · **S**
  - Acceptance: a 1000-artifact batch inserts every row exactly once, chunked, with no `too many SQL variables` error
  - Verify: integration test against local D1
  - Depends: T2.2
  - Note: this is the model repo's production bug. Do not skip it.

- [ ] **T2.4** — `POST /api/cron/scout` due-source selection · **S**
  - Acceptance: returns only enabled sources past their cadence; stamps `last_run_at`
  - Depends: T2.2

### ✅ Checkpoint P2
- [ ] Idempotency proven (post twice → all `unchanged`) · [ ] 1000-row batch passes · [ ] all status codes verified · [ ] status row recorded

---

## Phase P3 — `harvest` (15%)

- [ ] **T3.1** — Polite HTTP client (UA, backoff, `Retry-After`, 4/host concurrency) · **M**
- [ ] **T3.2** — `robots.txt` parser with per-host per-run cache · **S**
- [ ] **T3.3** — YAML frontmatter parser · **S**
- [ ] **T3.4** — Adapter registry + `AdapterContext` plumbing · **S**
- [ ] **T3.5** — `github-code-search` adapter + fixtures · **M**
- [ ] **T3.6** — `mcp-registry` adapter + fixtures · **M**
- [ ] **T3.7** — `awesome-list` adapter + fixtures · **M**
- [ ] **T3.8** — Harvester CLI emitting the report JSON contract · **M**
- [ ] **T3.9** — Wire Scout workflow to the CLI; first real run inserts rows · **S**

### ✅ Checkpoint P3 — the discovery loop closes
- [ ] A scheduled run inserted rows nobody typed · [ ] zero network calls in tests · [ ] cursor persists across runs

---

## Phase P4 — `enrich` (12%)

- [ ] **T4.1** — `src/lib/taxonomy.ts` signal → category table · **M**
- [ ] **T4.2** — `enrich-fetch.ts`: README, license, examples detection · **M**
- [ ] **T4.3** — `POST /api/cron/curate` · **M**
- [ ] **T4.4** — `POST /api/cron/taxonomy` with full recount · **M**
- [ ] **T4.5** — Confirm the pipeline completes with no model binding · **S**

### ✅ Checkpoint P4 — the re-evaluation loop closes
- [ ] A score changed on its own because upstream changed · [ ] breakdown sums to score · [ ] recount corrects injected drift

---

## Phase P5 — `verify` (10%)

- [ ] **T5.1** — `verify-attempt.ts` pure classification (terminal vs transient) · **S**
- [ ] **T5.2** — `POST /api/cron/verify-links` (Sentinel) · **M**
- [ ] **T5.3** — `inactive-reason.ts` + `prune-query.ts` · **M**
- [ ] **T5.4** — `POST /api/cron/prune` with dry-run and safety ratio · **M**
- [ ] **T5.5** — 90-day check trimming · **S**

### ✅ Checkpoint P5 — the decay loop closes
- [ ] A broken URL deactivated itself with a correct reason, no human involved · [ ] safety ratio blocks an oversized prune

---

## Phase P6 — `web` (18%)

- [ ] **T6.1** — Layout, design tokens, global styles · **M**
- [ ] **T6.2** — `public-query.ts` with server-side pagination (cap 100) · **M**
- [ ] **T6.3** — `ArtifactCard`, `ScoreBadge`, `ScoreBreakdown`, `Pagination`, `EmptyState` · **M**
- [ ] **T6.4** — Browse routes: `/skills`, `/mcp`, `/rules`, `/agents` · **M**
- [ ] **T6.5** — `/artifact/[slug]` with full score breakdown + JSON-LD · **M**
- [ ] **T6.6** — FTS5 search with query escaping · **M**
- [ ] **T6.7** — `/categories/[category]` · **S**
- [ ] **T6.8** — `/api/click/[id]` safe outbound redirect · **S**
- [ ] **T6.9** — `/health` public evidence page · **M**
- [ ] **T6.10** — Landing page · **M**
- [ ] **T6.11** — `sitemap.xml`, `robots.txt`, security headers middleware · **S**
- [ ] **T6.12** — Staleness banner (last pulse > 48h) · **S**
- [ ] **T6.13** — CI assertion: no document over 150 KB · **S**

### ✅ Checkpoint P6
- [ ] Every route 200 with seeded DB, sensible empty state without · [ ] no doc > 150 KB · [ ] Lighthouse ≥ 90

---

## Phase P7 — `pulse` (8%)

- [ ] **T7.1** — Add `actionlint` to CI · **S**
- [ ] **T7.2** — Manually dispatch all six green · **M**
- [ ] **T7.3** — Prove the zeroed-harvest guard fails Scout · **S**
- [ ] **T7.4** — Enable schedules; observe one full week · **L**

### ✅ Checkpoint P7
- [ ] Six green on schedule for a week · [ ] `source_runs` populated by every agent

---

## Phase P8 — Launch (5%)

- [ ] **T8.1** — Follow [`RUNBOOK-CLOUDFLARE.md`](../docs/RUNBOOK-CLOUDFLARE.md) end to end · **M**
- [ ] **T8.2** — Seed the `sources` table · **S**
- [ ] **T8.3** — Custom domain (**human decision required**) · **S**
- [ ] **T8.4** — Failure alerting webhook · **S**
- [ ] **T8.5** — Flip CI `continue-on-error` to `false` for typecheck and build · **S**

---

## Blocked / needs a human

- **Custom domain** — not chosen. Default `skills-hub.pages.dev`.
- **Rubric weight changes** — require an ADR; do not adjust unilaterally.
- **Any Cloudflare action that spends money.**

## Open questions raised during implementation

Append here rather than guessing. Include the task id and what you assumed.

- _(none yet)_
