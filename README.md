<div align="center">

# 🧭 Skills Hub

**A self-updating, self-researching directory of AI agent capabilities.**

Agent Skills · MCP servers · agent rulesets · subagents & commands —
discovered continuously from public sources, scored by a published rubric,
and re-verified on a schedule.

[![CI Guardrail](https://github.com/cyalcala/skills-hub/actions/workflows/ci-guardrail.yml/badge.svg)](https://github.com/cyalcala/skills-hub/actions/workflows/ci-guardrail.yml)
[![Scout Pulse](https://github.com/cyalcala/skills-hub/actions/workflows/gha-scout-pulse.yml/badge.svg)](https://github.com/cyalcala/skills-hub/actions/workflows/gha-scout-pulse.yml)
[![Sentinel Pulse](https://github.com/cyalcala/skills-hub/actions/workflows/gha-sentinel-pulse.yml/badge.svg)](https://github.com/cyalcala/skills-hub/actions/workflows/gha-sentinel-pulse.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## The problem

The agent-skills ecosystem is growing faster than anyone can track by hand.
Skills, MCP servers, and rule files are scattered across thousands of GitHub
repos, a few registries, and a long tail of awesome-lists.

Every existing index is a hand-curated README. Hand-curated READMEs rot. Six
months after publication, a third of the links are dead, half the projects are
abandoned, and nothing tells you which is which.

## The approach

Skills Hub answers exactly three questions, and nothing else:

1. **What exists for *X*?** — searchable, categorized, filterable by tool
2. **Is it maintained?** — freshness is scored, staleness is visible
3. **Does it actually work?** — every link is re-checked on a schedule

That narrowness is the product. This is not a marketplace, a package manager,
or a social network. It is an index that tells the truth about its own contents.

> **The one-sentence difference:** every other list is a README that rots; this
> one re-verifies its entire corpus on a schedule and publishes the evidence.

---

## How it works

Six autonomous agents run on GitHub Actions crons. Each one has a single job,
its own concurrency group, and its own failure thresholds.

| Agent | Cadence | Job |
|---|---|---|
| 🔭 **Scout** | every 6h | Discovers new artifacts from enabled public sources |
| 📚 **Curator** | daily | Re-parses and re-scores anything whose upstream changed |
| 🛡️ **Sentinel** | daily | HTTP-checks the oldest-checked slice of the corpus |
| ✂️ **Pruner** | weekly | Deactivates dead or stale entries, always with a reason |
| 🗺️ **Cartographer** | weekly | Rebuilds the taxonomy and recounts every category |
| 📜 **Chronicler** | weekly | Publishes the operational evidence rollup |

```text
      PUBLIC SOURCES                 GitHub Actions              Cloudflare
 ┌───────────────────────┐      ┌────────────────────┐      ┌────────────────┐
 │ GitHub Search API     │      │  🔭 Scout          │      │  Astro API     │
 │ MCP registries        │─────▶│  📚 Curator        │─────▶│  routes        │
 │ awesome-lists         │      │  🛡️ Sentinel       │ auth │      │         │
 │ RSS / sitemaps        │      │  ✂️ Pruner         │      │      ▼         │
 └───────────────────────┘      │  🗺️ Cartographer   │      │  D1 (SQLite)   │
                                │  📜 Chronicler     │      │      │         │
                                └────────────────────┘      │      ▼         │
                                                            │  Pages (SSR)   │
                                                            └────────────────┘
```

The read path never depends on the write path. A total harvest outage leaves
the site serving yesterday's data — never a 500.

---

## Quality scoring

Every artifact gets a 0–100 score from a **deterministic, published, and fully
transparent** rubric. No black box, no vibes, and the per-dimension breakdown is
visible on every detail page.

| Dimension | Weight | Measures |
|---|---:|---|
| Metadata | 25 | Valid frontmatter, a real description, tags, declared install targets |
| Documentation | 25 | README present, usage examples, depth of description |
| Freshness | 20 | Continuous decay from upstream's last-modified date |
| Licensing | 10 | Declared and permissive beats declared beats absent |
| Popularity | 20 | Stars, **logarithmic and capped** |

Popularity is capped at 20 points and compressed logarithmically **on purpose**.
A thoughtful, well-documented new skill can and should outscore a famous
abandoned one. That property is enforced by a test, not just a promise.

Full rubric: [`docs/QUALITY-RUBRIC.md`](docs/QUALITY-RUBRIC.md)

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Astro 5 (SSR) with React islands |
| Hosting | Cloudflare Pages |
| Database | Cloudflare D1 (SQLite) with FTS5 search |
| Scheduling | GitHub Actions cron workflows |
| Harvesters | TypeScript, `packages/harvester` |
| Tests | Vitest |
| Runtime | Node 22 / npm workspaces |

Modeled structurally on [`cyalcala/va-freelance-hub`](https://github.com/cyalcala/va-freelance-hub),
which proved this architecture in production — including the bugs it found the
hard way, which are pre-empted here and documented in
[the known traps list](docs/HANDOFF-NEMOTRON.md#8-known-traps).

---

## Project status

**Phase P0 complete — architecture and scaffold.** P1 onward is open work.

This repository is deliberately structured as a **handoff**: the architecture,
schema, wire contracts, scoring rubric, and test suite are finished, and
implementation is left to an autonomous coding model working against fixed
specs.

See [`docs/MASTER_EXECUTION_PLAN.md`](docs/MASTER_EXECUTION_PLAN.md) for the
weighted roadmap and [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)
for evidence-cited progress.

---

## Quick start

```bash
git clone https://github.com/cyalcala/skills-hub.git
cd skills-hub
npm install
```

```bash
cd apps/web && npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

```bash
npm test
```

No Cloudflare account is needed for local development through phase P4 —
`--local` D1 covers it. For deployment, follow
[`docs/RUNBOOK-CLOUDFLARE.md`](docs/RUNBOOK-CLOUDFLARE.md).

---

## Repository layout

```text
apps/web/                 Astro app — public site + ingest/cron API routes
  ├── migrations/         D1 schema
  ├── src/lib/            All SQL and pure logic lives here. Nowhere else.
  ├── src/pages/api/      Authenticated ingest and cron endpoints
  └── tests/              Vitest, pure-logic only
packages/harvester/       Source adapters and the harvest CLI
specs/                    Module contracts — the source of truth
docs/                     Plan, handoff, runbook, rubric, ADRs, policy
tasks/                    plan.md and the todo queue
.github/workflows/        Six pulse agents + CI guardrail
```

---

## Documentation

| Document | What it covers |
|---|---|
| [Master Execution Plan](docs/MASTER_EXECUTION_PLAN.md) | The full roadmap, architecture, risks |
| [Handoff for Nemotron/opencode](docs/HANDOFF-NEMOTRON.md) | How an AI model continues this work |
| [Capability Map](specs/CAPABILITY-MAP.md) | Module ids, dependencies, build order |
| [Quality Rubric](docs/QUALITY-RUBRIC.md) | How scores are computed |
| [Cloudflare Runbook](docs/RUNBOOK-CLOUDFLARE.md) | Exact deployment steps |
| [Data Policy](docs/DATA-POLICY.md) | Sourcing ethics, robots.txt, removal requests |
| [Sources](docs/SOURCES.md) | What we index and under what terms |
| [ADRs](docs/decisions/) | Why the big decisions went the way they did |

---

## Contributing and removals

**Source owners:** if you maintain something indexed here and want it removed,
open an issue titled `Removal request: <url>`. It will be honored without
argument. See [`docs/DATA-POLICY.md`](docs/DATA-POLICY.md).

**Everyone else:** this project indexes and links out. It does not host or
re-serve anyone's skill content — see
[ADR-003](docs/decisions/ADR-003-index-not-mirror.md).

---

## License

MIT — see [LICENSE](LICENSE).

Indexed metadata describes publicly available projects; each indexed project
remains under its own license, which is recorded and displayed alongside it.
