# Spec: `web`

**Module id:** `web` · **Depends on:** `db` · **Phase:** P6 (18%)

## Objective

The public surface. Someone arrives asking "what exists for X, is it maintained,
does it work" and leaves with an answer in under a minute.

Largest phase by weight, and the one with the most inherited traps.

## The hard constraint

**The read path never touches the write path.** `web` queries D1 directly and
never calls `/api/ingest`. A total harvest outage leaves the site serving
yesterday's data — never a 500. Every list route degrades to an empty state
rather than an error.

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing: what this is, top artifacts, recently added, corpus stats |
| `/skills` | Browse `kind = skill`, filterable |
| `/mcp` | Browse `kind = mcp` |
| `/rules` | Browse `kind = ruleset` |
| `/agents` | Browse `kind IN (subagent, command)` |
| `/artifact/[slug]` | Detail: description, score breakdown, license, freshness, link out |
| `/categories/[category]` | Category listing |
| `/search?q=` | FTS5 search across kinds |
| `/health` | Public evidence: source health, last pulse times, corpus counts |
| `/data-policy` | Sourcing ethics and removal process |
| `/api/click/[id]` | Counted outbound redirect |
| `/sitemap.xml` | Generated from D1 |
| `/robots.txt` | Static |

`/health` being public is a product feature, not an ops page. It is the proof
behind the claim that this index re-verifies itself.

## Non-negotiable performance rules

Every one of these is a bug the model repo actually shipped. Do not rediscover
them.

1. **Server-side pagination on every list route, from the first one you write.**
   Not "later when it's slow." Its `/categories/tech` shipped 980 KB of HTML and
   its homepage hit 1.75 MB before anyone noticed.
2. **No document over 150 KB.** Assert it in CI.
3. **Search uses FTS5**, never `LIKE '%...%'`.
4. **Every query must be index-aligned.** If you add a sort, add the index — see
   [`SPEC-db.md`](SPEC-db.md).
5. **Default page size 24, hard max 100.** A `?limit=100000` query string must
   not be able to ask D1 for the world.

## Rendering strategy

Astro SSR on Cloudflare Pages. React islands **only** where interaction demands
it — the search box and filter controls. Everything else is static HTML.

A directory is a reading surface. Shipping a SPA to render a list is how the
payload rules above get violated.

## Required states

Every list and detail route implements all four, explicitly:

- **Loaded** — normal
- **Empty** — "no results", with a way out (clear filters, browse all)
- **Error** — D1 unreachable; a friendly page, never a stack trace
- **Degraded** — data is stale (last pulse > 48h ago); render a visible banner
  rather than pretending freshness

The degraded state matters: silently serving week-old data while claiming
continuous verification would undermine the entire premise.

## Artifact detail page

Must show, for every artifact:

- Name, kind, summary, author, license
- **The quality score with its full per-dimension breakdown and notes** — the
  rubric's transparency promise is kept here or nowhere
- Freshness: upstream last-modified, as a relative age
- Link health: when last checked, and the result
- Install targets
- Outbound link via `/api/click/[id]`
- JSON-LD (`SoftwareSourceCode`) for search engines

## Outbound redirect safety

`/api/click/[id]` looks the artifact up **by id in the database** and redirects
to its stored `source_url`. It must never redirect to a URL supplied in the
query string, and it re-validates with `isSafeHttpUrl` before issuing a 302.

Skipping either check turns the endpoint into an open redirect that phishers
will find and use.

## SEO

- Unique `<title>` and meta description per route
- Canonical URLs; `noindex` on paginated pages past page 1
- JSON-LD on detail pages
- Sitemap generated from active artifacts only
- **Never** index-bait: no auto-generated thin pages for empty categories

## Project Structure

```
apps/web/src/layouts/Layout.astro
apps/web/src/components/           → ArtifactCard, ScoreBadge, ScoreBreakdown,
                                     Pagination, EmptyState, StalenessBanner,
                                     SearchBox (React island)
apps/web/src/lib/public-query.ts   → all read queries, paginated
apps/web/src/lib/fts-query.ts      → FTS5 query construction + escaping
apps/web/src/lib/outbound-url.ts   → redirect validation
apps/web/src/lib/json-ld.ts        → structured data
apps/web/src/middleware.ts         → security headers
apps/web/src/pages/…               → the routes above
```

## Security headers

Set in `middleware.ts` on every response: `Content-Security-Policy`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Strict-Transport-Security`.

## Testing Strategy

Pure logic in Vitest — pagination math, FTS query construction and escaping,
redirect validation, JSON-LD shape, staleness calculation. Route rendering is
verified against a seeded local D1.

Required:
- An FTS query containing `"` and `*` is escaped and cannot break the statement
- `?limit=100000` clamps to 100
- `?page=-1` and `?page=abc` do not throw
- The redirect rejects an artifact whose stored URL fails validation
- Every route returns 200 against a seeded DB, and an empty state against an
  empty one
- No rendered document exceeds 150 KB

## Boundaries

- **Always:** paginate server-side; use FTS5 for search; render all four states;
  validate the redirect target from the database.
- **Ask first:** adding a client-side framework beyond the two islands; adding a
  route that is not in the table above; changing the page-size cap.
- **Never:** load an unbounded result set; redirect to a query-string URL;
  render a raw error to a visitor; claim freshness when data is stale.

## Success Criteria

- [ ] Every route returns 200 with a seeded DB and a sensible empty state without
- [ ] No document exceeds 150 KB, asserted in CI
- [ ] Lighthouse performance ≥ 90 on `/` and a category page
- [ ] Search returns relevant results via FTS5 in under 200 ms
- [ ] The score breakdown is visible on every detail page
- [ ] The staleness banner appears when the last pulse is over 48h old
- [ ] `npm test` green

## Open Questions

- Should `/health` expose per-source failure detail publicly? It is honest, but
  it also tells a hostile source exactly how to stay ahead of us. Leaning:
  aggregate publicly, detail in the repo's committed rollup.
