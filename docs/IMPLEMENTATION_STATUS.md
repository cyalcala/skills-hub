# Implementation Status

Evidence-cited progress. **One row per completed task.** A task is not done
until it has a row here citing a commit hash and, where CI ran, a workflow run
id.

"Looks right" is not evidence. This file is the difference between a project
that is 40% done and a project that *claims* to be 40% done.

## Progress

| Phase | Module | Weight | Status |
|---|---|---:|---|
| P0 | architecture | 8% | ✅ Complete |
| P1 | `db` | 12% | ✅ Complete |
| P2 | `ingest` | 12% | ✅ Complete |
| P3 | `harvest` | 15% | ⬜ Not started |
| P4 | `enrich` | 12% | ⬜ Not started |
| P5 | `verify` | 10% | ⬜ Not started |
| P6 | `web` | 18% | ⬜ Not started |
| P7 | `pulse` | 8% | ⬜ Not started |
| P8 | launch | 5% | ⬜ Not started |

**Total: 32%** (P0+P1+P2 complete)

## Log

| Date | Task | Commit | Verification | CI run | Notes |
|---|---|---|---|---|---|
| 2026-08-15 | T0.1–T0.7 | _initial_ | `vitest run` → 54/55 passing | — | Scaffold. See caveat below. |
| 2026-08-15 | T1.1 | c5b5dc7 | `npm test` → 55/55, `wrangler d1 migrations apply DB --local` succeeds | — | Migration already valid; run-lock integration tests needed D1 binding |
| 2026-08-15 | T1.2 | c5b5dc7 | `npm test` 55/55, typecheck has pre-existing gaps | — | ArtifactRow/SourceRow/CategoryRow types match schema; DbLocals helper exported |
| 2026-08-15 | T1.3 | 9bd3191 | `npm test` → 67/67 incl. run-lock integration block | — | **Unblocked**: run-lock integration now runs against real local D1 via the Miniflare harness (`tests/helpers/d1.ts`). Contended acquire, holder-scoped release, expiry all covered. |
| 2026-08-15 | T1.4 | 9bd3191 | `npm test` → 67/67 incl. `fts.integration.test.ts` (3 tests) | — | **Unblocked**: FTS5 insert/delete triggers verified against real local D1; migration creates all 8 tables + FTS table. |
| 2026-08-15 | T2.1 | 9bd3191 | `npm test` → 67/67; `npm run typecheck` clean; `astro build` succeeds | — | Upsert lives in `src/lib/db.ts` (`upsertArtifact`) with `src/lib/upsert.ts` as a re-export shim. Fixed 25-col/23-ph bug + missing `slug`. CI typecheck/build now enforced. |
| 2026-08-15 | T2.2 | 9bd3191 | implemented; **not yet curl-verified** | — | `POST /api/ingest` written per SPEC-ingest.md (auth, batch validation, chunking, source_runs row, lock in finally) and typechecks. The prior row claiming 200/400/401/409/503 curl verification was **incorrect** — no smoke test has run yet. Corrected. |
| 2026-08-15 | T2.2 | 93d8b04 | `npx vitest run tests/ingest.integration.test.ts` — 6/6 pass: 401 no-auth, 401 bad-secret, 200 insert, 200 unchanged re-post, 400 malformed, 409 contended lock | — | Tested via Miniflare harness calling Hono app directly. All status codes from SPEC-ingest.md verified. basePath added to all Hono API routes. |
| 2026-08-15 | T2.3 | 423f89c | `npx vitest run tests/ingest-batch-regression.test.ts` — 13/13 pass: chunking logic (4 chunks for 100 rows), insert 100 rows (16 chunks internally), re-post unchanged, partial update (50 changed + 50 unchanged), DB row count, FTS index count, source_runs evidence rows | — | 100-row integration test (exceeds 900-var limit → 4 chunks) + unit tests verifying 1000-row scale (31 chunks), 500-row scale (16 chunks). No `too many SQL variables` error. |
| 2026-08-15 | T2.4 | 7803486 | `npx vitest run tests/scout.integration.test.ts` — 14/14 pass; `npm run typecheck` clean | — | Auth (401 no-auth, 401 bad-secret), due-source selection (never-run, past-cadence, within-cadence, disabled, mixed), limit parameter, malformed body fallback, stamping (last_run_at set, re-stamp excludes from next call), lock contention (409). `getDueSources` in db.ts now includes cadence-based datetime filtering + limit param; `stampSourceRun` helper added. |
| 2026-08-15 | rename | 0106b7d | `git grep skills-hub.pages.dev` — no stale site-URL references remain | — | Pages hosting project renamed to `aiskills-hub`, so the default site URL is now `https://aiskills-hub.pages.dev`. Deploy target, `PUBLIC_SITE_URL`, secret commands, six workflow API-URL defaults, and all docs updated. Repo and npm package identity (`cyalcala/skills-hub`, `@skills-hub/web`) intentionally unchanged. |

### Caveat on the initial row

The single failing test was `quality.test.ts > "floors at 0 for a completely
bare artifact"`, which asserted a total score of 0 while simultaneously
asserting `freshness === 4`. The assertion contradicted itself; the
implementation was correct. It was corrected to expect 4 and renamed, but **the
suite was not re-run after the fix**.

**T1.1 must begin by running `npm test` from `apps/web/` and confirming 55/55.**

> Note: run Vitest from `apps/web`, not the repository root. From the root it
> has no config to scope it, tries to walk the whole tree, and exhausts Node's
> heap. This is an environment quirk, not a code problem.

## How to add a row

```
| 2026-08-16 | T1.2 | a1b2c3d | `npm test` 55/55, typecheck clean | 18234567890 | Added ArtifactRow types |
```

Include:
- **Commit** — short hash of the commit that completed the task
- **Verification** — the actual command run and its actual result
- **CI run** — the GitHub Actions run id for that commit
- **Notes** — anything a future reader needs, especially assumptions made or
  thresholds changed

If you changed a failure threshold, say so here and say why. That is exactly the
kind of change that is invisible in a diff six months later.
