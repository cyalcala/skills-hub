# Spec: `enrich`

**Module id:** `enrich` · **Depends on:** `db` · **Phase:** P4 (12%)

## Objective

Turn a discovered artifact into a *described and ranked* one: parse what the
source actually contains, assign categories, and compute a transparent quality
score. This is the re-evaluation loop — the reason an entry's score changes over
time without anyone editing it.

Owned by the **Curator** (scoring, per-artifact) and the **Cartographer**
(taxonomy, corpus-wide).

## Interface ownership

This module owns the **quality rubric**, implemented in
`apps/web/src/lib/quality.ts` and published in
[`../docs/QUALITY-RUBRIC.md`](../docs/QUALITY-RUBRIC.md). Those two must never
disagree — the doc is the public promise and the code is the enforcement.

Changing a weight reorders the entire directory. It requires an ADR.

## The work queue

Curator selects artifacts where `enriched_at IS NULL` or `enriched_at` is older
than the artifact's `last_seen_at` — meaning ingest saw a content change and
cleared the stamp. Ordered by `enriched_at ASC` (NULLs first, which SQLite gives
us for free), capped by the run's `limit`.

That queue is index-backed by `idx_artifacts_enrich_queue`. Do not add a
different ordering without adding the matching index.

## Scoring rules

`scoreArtifact(input, now)` is **already implemented and tested**. The rules it
enforces, restated because they are product decisions and not implementation
detail:

- **Pure.** No clock reads, no network, no randomness. `now` is injected. This
  is what makes scores reproducible and golden-file testable.
- **Transparent.** Always returns a per-dimension `breakdown` and human-readable
  `notes`. A score the reader cannot interrogate is a score they cannot trust,
  and trustworthiness is the entire product.
- **Popularity is capped at 20/100 and logarithmic.** Linear stars would let one
  viral repo dominate every list forever. A well-documented new skill must be
  able to outscore a stale famous one — there is a test asserting exactly that.
- **Unknown ≠ stale.** A missing upstream date earns partial freshness credit,
  not zero.

Curator's job is to gather the `ScoreInput` fields honestly, then call it.

## Gathering the inputs

| Field | Source |
|---|---|
| `has_valid_frontmatter` | YAML frontmatter parsed with both `name` and `description` present |
| `has_readme` | A README was fetched successfully at the repo root |
| `has_examples` | A fenced code block, an `examples/` dir, or a `## Usage` heading |
| `stars`, `forks` | Host API, refreshed at enrich time |
| `license` | Host API SPDX id; `NOASSERTION` when the host cannot classify it |
| `source_updated_at` | Upstream's own last-modified, normalized to ISO-8601 UTC |

Any field that cannot be determined is left `undefined` and the rubric scores it
down. **Never guess a value to improve a score.**

## Categories

Deterministic keyword-and-signal mapping, not an LLM call. Defined in
`src/lib/taxonomy.ts` as an explicit table from signals → category slug. An
artifact can hold multiple categories; one is enough; zero routes it to
`uncategorized`, which is a visible bucket rather than a hidden one.

The Cartographer then **recounts** `categories.artifact_count` from scratch,
weekly. Counts are never incremented ad hoc anywhere else — incremental counters
drift, and a wrong count on a category page is the kind of small lie that erodes
trust in the whole index.

## The optional AI pass

Off by default, and the pipeline must be correct without it.

```
if (no model binding configured) → log once, skip, continue. Never throw.
```

When enabled, it may only *add* — a cleaner summary, extra tags. It may **never**
change `quality_score`. The score stays deterministic and auditable; that
boundary is what lets us publish the rubric honestly.

## Endpoints

### `POST /api/cron/curate`
Body `{ limit?: number, force?: boolean }`. Returns:
```json
{ "scored": 412, "skipped": 88, "errors": [] }
```
`force` re-scores even when the hash is unchanged — for after a rubric change.

### `POST /api/cron/taxonomy`
No body. Returns `{ "categories": 24, "recounted": 24, "driftCorrected": 0 }`.
Persistent nonzero `driftCorrected` means something is mutating counts outside
the Cartographer; find it.

## Project Structure

```
apps/web/src/lib/quality.ts              → the rubric                [DONE]
apps/web/src/lib/taxonomy.ts             → signal → category table   [TODO]
apps/web/src/lib/enrich-fetch.ts         → README/license gathering  [TODO]
apps/web/src/pages/api/cron/curate.ts    → Curator endpoint          [TODO]
apps/web/src/pages/api/cron/taxonomy.ts  → Cartographer endpoint     [TODO]
apps/web/tests/quality.test.ts           → [DONE]
apps/web/tests/taxonomy.test.ts          → [TODO]
```

## Testing Strategy

The rubric's tests are done and cover each dimension in isolation, the caps,
freshness decay monotonicity, the log-compression of stars, and determinism.

Still needed:
- Taxonomy mapping is deterministic and total (every input yields ≥1 category
  or explicitly `uncategorized`)
- The work queue selects only stale rows, in the right order
- A missing model binding skips the AI pass without throwing
- Recount corrects a deliberately corrupted `artifact_count`

## Boundaries

- **Always:** keep `scoreArtifact` pure; emit the breakdown; recount rather than
  increment; leave unknown inputs undefined.
- **Ask first:** changing any rubric weight (needs an ADR); enabling the AI pass
  in production; adding a scoring dimension.
- **Never:** let AI influence `quality_score`; guess an input to inflate a score;
  throw when the optional model is absent; hide why a score is low.

## Success Criteria

- [ ] A changed artifact is re-scored on the next Curator run, unprompted
- [ ] The stored `quality_breakdown` sums to `quality_score`
- [ ] Every artifact holds ≥1 category, or `uncategorized`
- [ ] Cartographer corrects a deliberately corrupted count to the true value
- [ ] The pipeline completes end to end with no model binding configured
- [ ] `npm test` green

## Open Questions

- Should `quality_score` be exposed in the public API, or only rendered? Leaning
  exposed — hiding it invites suspicion that it is arbitrary.
