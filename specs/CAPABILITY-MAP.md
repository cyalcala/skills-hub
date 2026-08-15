# Capability Map: Skills Hub

The initiative bundles several independently testable capabilities. This map is
the index of what exists. Module ids are **stable, kebab-case, and never
renamed** — specs, tasks, and handoff instructions select work by these ids
rather than by guessing which file is active.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `db` | D1 schema, migrations, typed query layer, run locks | — |
| `ingest` | Authenticated write API: batch upsert, dedupe, content hashing, run evidence | `db` |
| `harvest` | Source adapters that discover artifacts from public sources and POST them to ingest | `ingest` |
| `enrich` | Deterministic parsing, classification, and quality scoring; optional AI pass | `db` |
| `verify` | Link health checks, staleness detection, deactivation reasons | `db` |
| `web` | Public Astro surface: browse, search, filter, detail pages, SEO | `db` |
| `pulse` | GitHub Actions cron orchestration of the six agents | `harvest`, `enrich`, `verify` |
| `ops` | Docs, runbooks, ADRs, handoff, evidence trail | — |

**Build order:** `db` → `ingest` → `harvest`, `enrich` → `verify` → `web` → `pulse` → `ops`

`harvest` and `enrich` are parallelizable once `ingest` lands — they share no
files. `ops` is parallelizable throughout.

## Dependency direction

```
              ┌──────┐
              │  db  │
              └───┬──┘
        ┌─────────┼──────────┬───────────┐
        ▼         ▼          ▼           ▼
   ┌────────┐ ┌──────┐  ┌────────┐  ┌───────┐
   │ ingest │ │enrich│  │ verify │  │  web  │
   └───┬────┘ └───┬──┘  └───┬────┘  └───────┘
       ▼          │         │
  ┌─────────┐     │         │
  │ harvest │     │         │
  └────┬────┘     │         │
       └──────────┴────┬────┘
                       ▼
                  ┌────────┐
                  │ pulse  │
                  └────────┘
```

No cycles. Arrows point one way. `web` reads `db` directly and never calls
`ingest` — the read and write paths are separate so a harvest failure can never
take the public site down.

## Interface ownership

Contracts live in the **provider** module's spec, not the consumer's:

- The ingest wire format (`ArtifactInput`) is owned by [`SPEC-ingest.md`](SPEC-ingest.md).
  `harvest` adapters conform to it; they do not extend it.
- The `artifacts` row shape is owned by [`SPEC-db.md`](SPEC-db.md). `enrich` and
  `verify` write to columns that spec defines.
- The quality rubric is owned by [`SPEC-enrich.md`](SPEC-enrich.md) and mirrored
  in human-readable form at [`../docs/QUALITY-RUBRIC.md`](../docs/QUALITY-RUBRIC.md).

## Module specs

| Module | Spec |
|---|---|
| `db` | [SPEC-db.md](SPEC-db.md) |
| `ingest` | [SPEC-ingest.md](SPEC-ingest.md) |
| `harvest` | [SPEC-harvest.md](SPEC-harvest.md) |
| `enrich` | [SPEC-enrich.md](SPEC-enrich.md) |
| `verify` | [SPEC-verify.md](SPEC-verify.md) |
| `web` | [SPEC-web.md](SPEC-web.md) |
| `pulse` | [SPEC-pulse.md](SPEC-pulse.md) |
| `ops` | Covered by [../docs/MASTER_EXECUTION_PLAN.md](../docs/MASTER_EXECUTION_PLAN.md) |

## What is deliberately out of scope for v1

Recording these prevents scope drift during implementation:

- User accounts, auth, favorites, or any write path open to the public
- Hosting or re-serving skill *content* — the directory indexes and links out,
  it does not mirror source files (see [ADR-003](../docs/decisions/ADR-003-index-not-mirror.md))
- Paid listings, submissions queue, or moderation UI
- Vector/semantic search — v1 uses SQLite FTS5
- Any scraper that ignores `robots.txt` or a source's terms
