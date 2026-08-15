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
| P2 | `ingest` | 12% | 🔄 In progress |
| P3 | `harvest` | 15% | ⬜ Not started |
| P4 | `enrich` | 12% | ⬜ Not started |
| P5 | `verify` | 10% | ⬜ Not started |
| P6 | `web` | 18% | ⬜ Not started |
| P7 | `pulse` | 8% | ⬜ Not started |
| P8 | launch | 5% | ⬜ Not started |

**Total: 20%** (P0+P1 complete)

## Log

| Date | Task | Commit | Verification | CI run | Notes |
|---|---|---|---|---|---|
| 2026-08-15 | T0.1–T0.7 | _initial_ | `vitest run` → 54/55 passing | — | Scaffold. See caveat below. |
| 2026-08-15 | T1.1 | c5b5dc7 | `npm test` → 55/55, `wrangler d1 migrations apply DB --local` succeeds | — | Migration already valid; run-lock integration tests needed D1 binding |
| 2026-08-15 | T1.2 | c5b5dc7 | `npm test` 55/55, typecheck has pre-existing gaps | — | ArtifactRow/SourceRow/CategoryRow types match schema; DbLocals helper exported |
| 2026-08-15 | T1.3 | c5b5dc7 | `npm test` → 67/67 incl. run-lock integration block | — | **Unblocked**: run-lock integration now runs against real local D1 via the Miniflare harness (`tests/helpers/d1.ts`). Contended acquire, holder-scoped release, expiry all covered. |
| 2026-08-15 | T1.4 | c5b5dc7 | `npm test` → 67/67 incl. `fts.integration.test.ts` (3 tests) | — | **Unblocked**: FTS5 insert/delete triggers verified against real local D1; migration creates all 8 tables + FTS table. |
| 2026-08-15 | T2.1 | c5b5dc7 | `npm test` → 67/67; upsert implemented | — | Upsert lives in `src/lib/db.ts` (`upsertArtifact`) with `src/lib/upsert.ts` as a re-export shim. Bug fixed: INSERT had 25 columns / 23 placeholders; slug (NOT NULL UNIQUE) was missing. |
| 2026-08-15 | T2.2 | _uncommitted_ | implemented; **not yet curl-verified** | — | `POST /api/ingest` written per SPEC-ingest.md (auth, batch validation, chunking, source_runs row, lock in finally) and typechecks. The prior row claiming 200/400/401/409/503 curl verification was **incorrect** — no smoke test has run yet. Corrected. |

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
