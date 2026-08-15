# Skills Hub — Agent Context

Conventions for any AI model or human working in this repository.
For the full onboarding path, read [`docs/HANDOFF-NEMOTRON.md`](docs/HANDOFF-NEMOTRON.md).

## What this is

A self-updating, self-researching directory of AI agent capabilities — Agent
Skills, MCP servers, agent rulesets, and subagent/command packs. Discovered
continuously from public sources, scored by a published deterministic rubric,
and re-verified on a schedule.

Owner: `cyalcala` · Repository: `cyalcala/skills-hub`
Modeled structurally on `cyalcala/va-freelance-hub`.

## Current reality

**Phase P0 complete: architecture and scaffold only.** The specs, schema, wire
contracts, quality rubric, pulse workflows, and pure-logic tests exist. Almost
no runtime code does — no API routes, no adapters, no pages.

This repository is deliberately a **handoff**: the thinking is finished,
implementation is not.

## Stack

- Node 22 · npm workspaces (**not** Bun — see [ADR-004](docs/decisions/ADR-004-npm-over-bun.md))
- Astro 5 SSR, React islands only where interaction requires it
- Cloudflare Pages + D1 (SQLite) with FTS5
- GitHub Actions cron "pulse" agents
- Vitest

## Where things live

```
specs/          Module contracts — THE source of truth for any interface
docs/           Plan, handoff, runbook, rubric, policy, ADRs
tasks/          plan.md (reasoning) and todo.md (the queue)
apps/web/       Astro app: public site + ingest/cron API routes
  src/lib/      ALL SQL and pure logic. Nothing else writes SQL.
  migrations/   D1 schema
  tests/        Vitest, pure logic only
packages/harvester/  Source adapters + harvest CLI
.github/workflows/   Six pulse agents + CI guardrail
```

## The six agents

🔭 Scout (discover, 6h) · 📚 Curator (re-score, daily) · 🛡️ Sentinel
(link-check, daily) · ✂️ Pruner (deactivate, weekly) · 🗺️ Cartographer
(taxonomy, weekly) · 📜 Chronicler (evidence rollup, weekly)

## Non-negotiable principles

1. **Index, never mirror.** Store metadata, link out.
2. **Deterministic before intelligent.** AI enrichment is optional and may never
   influence `quality_score`.
3. **The read path never depends on the write path.** A harvest outage serves
   stale data, never a 500.
4. **Source compliance is a requirement.** Public visibility is not permission.
5. **Evidence over vibes.** Every pulse writes a `source_runs` row; every
   completed task cites a commit and a run id.
6. **Green CI can hide source-level failure.** Thresholds are explicit and must
   not be relaxed to turn a run green.

## Hard rules

- Never invent a contract. If a spec does not define it, ask in `tasks/todo.md`.
- Never write raw SQL outside `apps/web/src/lib/`.
- Never delete an artifact row — deactivate with an `inactive_reason`.
- Never commit a secret. CI scans for this.
- Never weaken or skip a failing test to make CI green.
- Never mark a task done without running its verification.
- Keep `scoreArtifact` pure — no clock, no network, no randomness.
- Respect `robots.txt`, rate limits, and API terms in every adapter.

Full list with rationale: [`docs/HANDOFF-NEMOTRON.md`](docs/HANDOFF-NEMOTRON.md) §3.

## Working loop

One task → one commit → one verification → one status row. Never batch.

```bash
npm install
cd apps/web && npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm test          # run from apps/web, NOT the repo root
```

> Running Vitest from the repository root exhausts Node's heap — it has no
> config there and walks the whole tree. Always run it from `apps/web`.

## Commit style

Conventional commits scoped by module id:

```
feat(db): add artifacts table and ordering-aligned indexes
fix(ingest): chunk batch upserts by variable count, not row count
```

The body explains *why*. The diff already shows *what*.

## Known traps

Inherited from the model repo's production audit — each already cost someone
real time. Full list in [`docs/HANDOFF-NEMOTRON.md`](docs/HANDOFF-NEMOTRON.md) §8.

1. D1 `too many SQL variables` — chunk by rows × columns, not rows
2. Green CI hiding zero-row harvests
3. Indexes not aligned with `ORDER BY`
4. HTML payload bloat — paginate server-side from the first list route
5. Mixed-format dates — normalize to ISO-8601 UTC on write
6. `MessageChannel` missing in the Pages build validator (patched in `astro.config.mjs`)
