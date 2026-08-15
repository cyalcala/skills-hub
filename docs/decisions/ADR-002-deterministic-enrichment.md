# ADR-002 — Deterministic scoring, with AI strictly optional

**Status:** Accepted · **Date:** 2026-08-15

## Context

Artifacts need summarizing, tagging, categorizing, and ranking. The obvious
modern approach is to call an LLM on every ingest. The alternative is to derive
everything from parsing and structured signals.

## Decision

**Every artifact gets a complete record from pure, deterministic parsing.**
The quality score is computed by a published rubric with no model in the loop.

An optional AI pass may *add* a cleaner summary or extra tags when a model
binding is configured. It may **never** influence `quality_score`, and its
absence must never block or fail the pipeline.

## Rationale

**Reproducibility is the product.** The directory's pitch is that it tells the
truth about its contents. A score that changes because a model was sampled
differently is not a fact, and cannot be defended when someone asks "why is my
skill rated 41?" The rubric can be published, argued with, and tested.

**No key, no dependency, no bill.** A contributor can clone this repo and run
the full pipeline with zero API keys. That materially lowers the barrier to the
handoff succeeding, and it means the scheduled pulses cannot fail on a quota.

**Cost scales with corpus size.** Scoring tens of thousands of artifacts daily
through an LLM is a real recurring bill for a free public directory. Parsing is
effectively free.

**Determinism is testable.** `scoreArtifact` is a pure function of
`(input, now)`. It has golden-file tests. A model call has none of those
properties.

## Consequences

**Good:** free to run; reproducible; auditable; testable; no key management;
the rubric is a publishable artifact that builds trust.

**Bad:** weaker semantic understanding. Keyword-based categorization will
misfile some artifacts that a model would place correctly. Summaries are
extracted rather than written, so they read less smoothly.

**Mitigation:** the optional AI overlay closes some of that gap for whoever
turns it on, without any of the costs landing on the default path.

**Enforcement:** `scoreArtifact` must stay pure — no clock reads, no network,
no randomness. `now` is injected. This is listed as a hard rule in the handoff
and covered by a determinism test.
