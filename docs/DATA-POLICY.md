# Data Policy

How Skills Hub sources data, what it stores, and how to get something removed.

This is a first-class requirement, not a footnote. **Public visibility is not
permission.** A page being reachable does not mean its terms allow automated
collection, and this project treats that distinction as a hard boundary.

## What we index

Publicly published metadata *about* AI agent capabilities: name, description,
author, license, tags, repository URL, star counts, and timestamps.

## What we do not do

- **We do not mirror content.** No skill bodies, no README text served as our
  own, no re-hosted files. We store a summary and link to the source. See
  [ADR-003](decisions/ADR-003-index-not-mirror.md).
- **We do not collect personal data.** No accounts, no tracking cookies, no
  analytics scripts, no fingerprinting. Outbound click counts record an artifact
  id, a timestamp, and a referring host — no IP address, no user agent.
- **We do not bypass access controls.** No CAPTCHA solving, no rate-limit
  evasion, no rotating user agents to dodge a block, no scraping behind a login.
- **We do not index private or gated material.** If it needs credentials, it is
  out of scope.

## Crawler conduct

Every adapter must:

1. Send a descriptive `User-Agent` naming the project with a contact URL, so an
   operator who sees our traffic can find and reach us.
2. Check and honor `robots.txt` before any non-API HTML fetch.
3. Honor `Retry-After` on 429 and 503, backing off exponentially with jitter.
4. Cap concurrency at 4 in-flight requests per host.
5. Prefer official APIs and feeds over HTML scraping, always.
6. Use conditional requests (`ETag`, `If-Modified-Since`) where supported.
7. Record a `termsNote` in the `sources` table stating the compliance basis for
   that source. **An adapter that cannot state its basis does not ship.**

If a source blocks us, the correct response is to stop — set `enabled = 0` and
record why. Working around a block is never acceptable, regardless of how
technically easy it is.

## Licensing

Each indexed project remains under its own license. We record and display that
license alongside every artifact so a reader knows their reuse rights before
clicking through.

Skills Hub's own code is MIT. The *compilation* of metadata is offered freely;
we make no ownership claim over the projects described.

## Removal requests

**If you maintain something indexed here and want it removed, it will be
removed. No argument, no justification required.**

Open an issue titled `Removal request: <url>` at
<https://github.com/cyalcala/skills-hub/issues>.

What happens:

1. The artifact is deactivated (`is_active = 0`, reason `removal_requested`)
   and disappears from the public site.
2. Its `source_url` is added to a permanent exclusion list, so a future harvest
   cannot silently re-add it.
3. You get a reply on the issue confirming both.

Target turnaround is 72 hours. Because the exclusion list is permanent, removal
is durable rather than something that quietly reverses on the next pulse.

## Corrections

If a score, license, or description is wrong, open an issue titled
`Correction: <url>`. Note that scores are computed by a
[published deterministic rubric](QUALITY-RUBRIC.md) — if a score looks wrong,
the underlying signal is usually wrong or missing, and fixing that fixes the
score on the next Curator run.

## Retention

| Data | Retention |
|---|---|
| Artifact metadata | Indefinite, including deactivated rows |
| Link check history | 90 days |
| Run evidence (`source_runs`) | 1 year, then rolled up to monthly aggregates |
| Outbound click counts | Indefinite, aggregate only |
| Workflow artifacts | 14 days (30 for Pruner) |

Deactivated rows are kept on purpose: the record that something *was* indexed
and then died is exactly the information a rot-tracking directory exists to
provide. Removal requests are the exception — those are excluded, not retained.

## Contact

Open an issue on the repository. For anything you would rather not raise in
public, note that in the issue and a private channel will be arranged.
