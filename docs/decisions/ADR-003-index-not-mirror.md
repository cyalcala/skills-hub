# ADR-003 — Index and link out; never mirror content

**Status:** Accepted · **Date:** 2026-08-15

## Context

A directory of skills could store the actual skill content — `SKILL.md` bodies,
server configs, rule files — and serve them directly. That would enable
full-text search over real content, offline browsing, one-click install, and
survival of upstream deletion.

## Decision

Store **metadata only**: name, summary, tags, license, author, timestamps,
quality signals, and the canonical URL. Link out for the content itself.

Descriptions are capped at 4000 characters and are extracted summaries, not
reproductions.

## Rationale

**Licensing.** Indexed projects carry many different licenses, and a meaningful
share carry none at all — `NOASSERTION` is common. Redistributing unlicensed
work is not something a public directory should do on the author's behalf, and
asking permission at scale is not viable.

**Attribution and traffic.** Authors publish to be found and used. Mirroring
intercepts the traffic that is their only real compensation. Linking out aligns
our interests with theirs, which matters a great deal for a project that depends
on authors not objecting to being indexed.

**Trust.** "We link to things" is an easy relationship to have with thousands of
maintainers. "We host copies of your work" is a relationship that generates
removal requests, license disputes, and staleness complaints.

**Staleness.** A mirror is wrong the moment upstream changes. A link is never
stale — and the freshness score already tells the reader how old the *upstream*
is, which is the honest signal.

**Scope discipline.** Mirroring makes this a package registry. Package
registries are a much harder problem — versioning, integrity, supply chain,
takedowns — and the ecosystem already has ones. Our narrow value is knowing
what exists and whether it is alive.

## Consequences

**Good:** no licensing exposure; aligned with author incentives; nothing goes
stale on our side; storage stays tiny; removal requests are trivially honored.

**Bad:** no full-text search over actual skill *bodies* — only over metadata and
summaries. No offline use. No one-click install. If upstream disappears, we
retain only the record that it existed, not the content.

**Accepted:** the last point is a genuine loss. A deactivated artifact's row is
kept precisely so the historical record survives even when the content does not,
which is a partial consolation and the honest limit of this approach.

## Related

- [`DATA-POLICY.md`](../DATA-POLICY.md) — the public statement of this position
- [ADR-002](ADR-002-deterministic-enrichment.md) — why we do not send content to
  a model either
