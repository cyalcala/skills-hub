# ADR-001 — Six single-purpose pulse agents on GitHub Actions

**Status:** Accepted · **Date:** 2026-08-15

## Context

The directory must continuously discover, re-evaluate, and retire artifacts.
That is scheduled background work. The options were:

1. **Cloudflare Cron Triggers** — a Worker on a schedule, close to the data
2. **One monolithic scheduled job** — a single "sync everything" run
3. **Several single-purpose GitHub Actions workflows** — the model repo's pattern

## Decision

Six single-purpose GitHub Actions workflows: Scout, Curator, Sentinel, Pruner,
Cartographer, Chronicler. Each with its own cron, concurrency group, and failure
thresholds.

## Rationale

**Why GitHub Actions over Cloudflare Cron Triggers.** Workers have a hard CPU
time limit per invocation, and harvesting is long-tail I/O against slow third
parties. Actions gives 20-minute runs, a full Node environment, free egress, and
— decisively — **a visible run history with logs and downloadable evidence**.
The operational story is the product's credibility here, so a scheduler with a
public audit trail is worth more than proximity to the database.

**Why six agents rather than one job.** A monolith fails as a unit. If discovery
breaks, verification stops too, and the corpus silently rots while CI stays
green. Separate workflows mean separate failure domains, separate thresholds,
separate badges. Sentinel keeps checking links even when Scout is broken.

**Why detection and deactivation are split** (Sentinel vs Pruner). This is the
most important part of the decision. If the agent that checks links could also
deactivate them, one bad network afternoon would wipe a large slice of the
corpus. Splitting them means deactivation always acts on *recorded history*
across multiple runs, never on a single live observation.

## Consequences

**Good:** independent failure domains; public evidence trail; generous runtime;
each agent's thresholds tuned to its own definition of "healthy"; free.

**Bad:** six files sharing a structure that must be kept in sync by hand
(`gha-scout-pulse.yml` is the designated reference). Cron scheduling on shared
runners is best-effort — a pulse may start late. Network hop from Actions to
Cloudflare adds latency and one more failure mode versus a Worker.

**Accepted risk:** GitHub Actions scheduled workflows are disabled automatically
after 60 days of repository inactivity. The Chronicler's weekly commit
incidentally prevents this, which is a happy accident worth knowing about.
