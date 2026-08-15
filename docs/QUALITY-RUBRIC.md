# Quality Rubric

Every artifact in Skills Hub carries a score from 0 to 100. This page is the
complete, public definition of how that number is produced.

**It is enforced by code** — `apps/web/src/lib/quality.ts` — and covered by
tests. If this page and that file ever disagree, that is a bug worth reporting.

## Principles

1. **Deterministic.** The same artifact evaluated on the same day always yields
   the same score. No randomness, no model calls, no hidden inputs.
2. **Transparent.** Every artifact's page shows the per-dimension breakdown and
   the specific reasons for deductions. Nothing is a black box.
3. **Not a popularity contest.** Stars are capped at 20 of 100 and compressed
   logarithmically. A careful new skill can outscore a famous abandoned one —
   and there is a test asserting exactly that.
4. **Unknown is not the same as bad.** Missing information scores lower than
   confirmed-good, but higher than confirmed-bad.

## Dimensions

### Metadata — 25 points

Is the artifact well-formed and self-describing?

| Signal | Points |
|---|---:|
| Valid frontmatter with both `name` and `description` | 12 |
| Description ≥ 40 characters | 7 |
| Description present but shorter | 3 |
| 3 or more tags | 4 |
| 1–2 tags | 2 |
| Declares at least one install target | 2 |

### Documentation — 25 points

Can a person actually use this?

| Signal | Points |
|---|---:|
| README present | 10 |
| Usage examples detected | 8 |
| Body text ≥ 800 characters | 7 |
| Body text ≥ 250 characters | 4 |
| Body text present but shorter | 2 |

### Freshness — 20 points

Decays continuously from the upstream last-modified date. No cliff edges —
an artifact does not lose 15 points for being one day older.

| Age | Points |
|---|---:|
| ≤ 30 days | 20 |
| 31–365 days | Linear decay, 20 → 5 |
| 1–2 years | 3 |
| > 2 years | 0 |
| Unknown | 4 |

Unknown scores above two-years-stale on purpose: absence of a date is a
metadata gap, not evidence of abandonment.

### Licensing — 10 points

| Signal | Points |
|---|---:|
| Declared permissive license (MIT, Apache-2.0, BSD, ISC, MPL-2.0, Unlicense, CC0) | 10 |
| Declared, but more restrictive | 6 |
| None declared, or `NOASSERTION` | 0 |

Restrictive is not penalized to zero — it is a legitimate choice, but it does
affect whether a reader can reuse the work, which is what this dimension
measures.

### Popularity — 20 points

`round(log10(stars + 1) × 5)`, capped at 20.

| Stars | Points |
|---:|---:|
| 0 | 0 |
| 10 | 5 |
| 100 | 10 |
| 1,000 | 15 |
| 10,000+ | 20 |

Logarithmic and capped is the single most important design decision in this
rubric. Linear stars would mean the directory just re-ranks GitHub's existing
popularity, which is not useful — you can already sort GitHub by stars. The
value here is surfacing things that are *good* but not yet *known*.

## Reading a score

| Range | Interpretation |
|---|---|
| 80–100 | Well-documented, maintained, clearly licensed |
| 60–79 | Solid. Usually missing examples or a little stale |
| 40–59 | Usable but under-documented, or aging |
| 20–39 | Significant gaps — thin metadata, no license, or quite stale |
| 0–19 | Barely described, or effectively abandoned |

A low score is **not** a claim that the work is bad. It measures how well the
artifact presents and maintains itself as a *reusable public artifact*. Plenty
of excellent private-purpose code scores low here, correctly.

## Changing the rubric

Weights are a published promise. Changing one reorders the entire directory, so
it requires:

1. An ADR in `docs/decisions/` explaining the reasoning
2. A version bump recorded here
3. A full re-score run (`POST /api/cron/curate` with `force: true`)

## Version

**v1.0** — initial rubric, 2026-08-15. Discoverability is reserved as a sixth
dimension at weight 0; it is folded into Metadata for now.
