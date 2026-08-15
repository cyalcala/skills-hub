# Sources

What Skills Hub indexes, and the compliance basis for each.

Sources live in the `sources` table, not in code. Adding, disabling, or
re-cadencing one is a **data change with no deploy** — which matters, because a
source that starts misbehaving needs to be switchable off in seconds.

Every row requires a `notes` value recording its basis. See
[`DATA-POLICY.md`](DATA-POLICY.md).

## Phase P3 — the first three

Chosen for high signal and low risk. Breadth comes after the discovery loop
closes.

### 1. GitHub code search — `github-code-search`

| | |
|---|---|
| **Yields** | `skill` |
| **Endpoint** | GitHub REST `/search/code` |
| **Basis** | Official API, authenticated, within documented rate limits |
| **Limits** | 5000 req/h authenticated; 10 results/page for code search |
| **Cadence** | 6h |
| **Risk** | Low. First-party API with clear terms. |

Finds `SKILL.md` files and parses their frontmatter. Malformed frontmatter is
*not* a rejection — the artifact is emitted with `has_valid_frontmatter: false`
and the rubric scores it down. Judging quality is the Curator's job.

### 2. MCP registry — `mcp-registry`

| | |
|---|---|
| **Yields** | `mcp` |
| **Endpoint** | `https://registry.modelcontextprotocol.io/v0/servers` |
| **Basis** | Public JSON API intended for programmatic consumption |
| **Cadence** | 12h |
| **Risk** | Low. Structured, generous, purpose-built for this. |

### 3. Awesome lists — `awesome-list`

| | |
|---|---|
| **Yields** | configured per list |
| **Endpoint** | `raw.githubusercontent.com` markdown |
| **Basis** | Public repo content fetched via GitHub's raw host |
| **Cadence** | 24h |
| **Risk** | Medium — noisy parsing, not access. Cap 500 rows per list. |

Extracts links under headings, ignoring badges and tables of contents. The
noise is in extraction quality, not in permission.

## Candidates for later phases

Not enabled. Each needs its compliance basis confirmed before it ships.

| Source | Yields | Note |
|---|---|---|
| GitHub topic search (`claude-skill`, `mcp-server`) | mixed | Same API, different query. Easy win after P3. |
| `awesome-claude-code` and similar curated lists | skill, command | Same adapter, new locators |
| Cursor rules directories | ruleset | Confirm terms per site first |
| Smithery / MCP aggregators | mcp | Check for an official API before considering HTML |
| GitLab code search | skill, mcp | Broadens beyond GitHub; needs an adapter |
| Package registries (npm, PyPI) filtered by keyword | mcp | Official APIs, high volume, needs tight filtering |

## Explicitly excluded

| Source type | Why |
|---|---|
| Anything behind a login | Out of scope per data policy |
| Sites whose `robots.txt` disallows us | Non-negotiable |
| Sites whose ToS forbid automated collection | Non-negotiable, regardless of technical ease |
| Rendered-HTML scraping where an API exists | Fragile and impolite |
| Private or internal company skill repos | Not public |

## Source health

Each source carries `health` (`healthy` / `degraded` / `failing` / `unknown`)
and a `consecutive_failures` counter, both maintained by Scout and published
weekly by the Chronicler to `docs/source-health-latest.md`.

A source at `failing` for three consecutive runs should be investigated and, if
it is blocking us deliberately, disabled rather than retried harder.
