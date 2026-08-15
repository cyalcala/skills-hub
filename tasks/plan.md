# Implementation Plan — Skills Hub

Companion to [`todo.md`](todo.md). This file holds the reasoning; `todo.md`
holds the queue.

The full narrative plan is
[`../docs/MASTER_EXECUTION_PLAN.md`](../docs/MASTER_EXECUTION_PLAN.md). This is
the planning-mechanics view: dependency graph, slicing rationale, parallelism,
and risk.

## Overview

Build a self-updating directory of AI agent capabilities as eight weighted
phases, foundation-first, with a verification checkpoint between each. Each
phase maps to one module id from
[`../specs/CAPABILITY-MAP.md`](../specs/CAPABILITY-MAP.md).

## Architecture decisions

Recorded as ADRs, summarized here:

- **[ADR-001](../docs/decisions/ADR-001-pulse-agent-architecture.md)** — six
  single-purpose GitHub Actions agents, not one monolith and not Cloudflare Cron
  Triggers. Independent failure domains and a public evidence trail.
- **[ADR-002](../docs/decisions/ADR-002-deterministic-enrichment.md)** —
  deterministic scoring; AI strictly optional and barred from the score.
- **[ADR-003](../docs/decisions/ADR-003-index-not-mirror.md)** — index metadata
  and link out; never re-host content.
- **[ADR-004](../docs/decisions/ADR-004-npm-over-bun.md)** — npm workspaces
  rather than the model repo's Bun, for handoff portability.

## Dependency graph

```
                    db (P1)
                      │
        ┌─────────────┼──────────────┬───────────┐
        ▼             ▼              ▼           ▼
   ingest (P2)   enrich (P4)   verify (P5)   web (P6)
        │             │              │
        ▼             │              │
   harvest (P3)       │              │
        └─────────────┴──────┬───────┘
                             ▼
                        pulse (P7)
                             ▼
                       launch (P8)
```

Foundations first. `db` gates everything because the row shape is the widest
contract in the system — getting it wrong after `ingest` ships means migrating
live data.

## Slicing rationale

Phases are **vertical slices that each close a loop**, not horizontal layers.

The temptation with a project like this is to build all the adapters, then all
the scoring, then all the UI. That would leave nothing verifiable until the very
end. Instead:

- **P3 closes the discovery loop** — after it, rows appear that nobody typed.
  That is a demonstrable capability even with no UI.
- **P4 closes the re-evaluation loop** — a score changes on its own.
- **P5 closes the decay loop** — a dead thing removes itself.

Those three loops *are* the product promise. `web` (P6) is the largest single
phase but the least risky, because by then the data is already real and correct.
Building the UI earlier would mean building it against fixtures and rebuilding
it against reality.

**If scope must be cut, cut breadth of sources — never a loop.** A directory
with only discovery is a growing pile of rot, which is precisely the thing this
project exists to fix.

## Parallelization

| Can run in parallel | Must be sequential |
|---|---|
| `enrich` and `harvest` after P2 (no shared files) | `db` → everything |
| `ops` docs throughout | `ingest` → `harvest` (wire contract) |
| Adapter implementations T3.5–T3.7 | Migrations (single writer) |
| Web components T6.3 against fixtures | `verify` detection → deactivation |

Two agents could reasonably split P3 and P4 once P2 lands. Anything touching
`migrations/` or `src/lib/db.ts` must not be parallelized — those are shared
contract surfaces.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| D1 `too many SQL variables` | High | Chunk by variable count; T2.3 is a mandatory regression test |
| Silent zero-row harvest, green CI | High | `MIN_TOTAL_ACCEPTED` guard; T7.3 proves the guard itself works |
| GitHub API rate limits | High | Authenticated requests, ETags, resumable cursors, per-source cadence |
| Front-end payload bloat | Med | Server-side pagination from T6.2; 150 KB CI assertion at T6.13 |
| Schema change after P2 ships | Med | Over-specify the row shape now; schema changes become "ask first" from P2 |
| Source blocks or changes terms | Med | `sources.enabled` flips with no deploy |
| Implementing model guesses a contract | Med | Specs own every interface; handoff rule #1 forbids invention |
| Rubric contested as unfair | Low | Published, deterministic, per-artifact breakdown visible |

## Verification strategy

Per-task acceptance criteria sit on top of a standing bar, defined in
[`../docs/HANDOFF-NEMOTRON.md`](../docs/HANDOFF-NEMOTRON.md) §5. Summarized: a
test that would fail if the change were reverted, the full suite green, runtime
behavior observed for anything touching D1 or HTTP, docs updated in the same
commit, CI green, and a status row citing commit hash and run id.

Checkpoints sit between phases. A checkpoint is not passed until its box is
ticked in `todo.md` with evidence.

## Current state

**P0 complete.** Architecture, schema, contracts, rubric, workflow scaffolding,
and the pure-logic test suite exist. Verified: 54 of 55 unit tests passing at
scaffold time; the one failure was a self-contradictory assertion in the test
itself, since corrected but **not yet re-run**. T1.1 should confirm the suite is
fully green before anything else proceeds.

Not yet built: every API route, every adapter, every page, `db.ts`, `taxonomy.ts`,
and the harvester package beyond its directory structure.
