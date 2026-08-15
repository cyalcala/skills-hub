# Runbook — Cloudflare setup

Exact steps to take this repository from clone to deployed. Follow in order.

**Nothing in this repo touches a Cloudflare account until you run these
commands.** The committed `wrangler.jsonc` carries a placeholder database id.

**You do not need any of this for phases P1–P4.** Local D1 (`--local`) covers
development through the enrich phase. Come back here when you are ready to
deploy.

---

## Prerequisites

- A Cloudflare account (the free tier is sufficient to start)
- Node 22+ and npm
- `gh` CLI authenticated, for setting repository secrets

---

## 1. Authenticate wrangler

```bash
npx wrangler login
```

Opens a browser for OAuth. Verify:

```bash
npx wrangler whoami
```

> **Known issue:** local D1 reads can fail with Cloudflare API error 7403 even
> when authenticated. This bit the model repo. If it happens, use `--local` for
> development and read production state through workflow evidence instead of
> fighting it.

---

## 2. Create the D1 database

```bash
npx wrangler d1 create skills-hub-db
```

Output includes a `database_id`. **Copy it into `apps/web/wrangler.jsonc`**,
replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Commit that change — the database id is not a secret.

---

## 3. Apply migrations

Locally first:

```bash
cd apps/web
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

Verify the schema landed:

```bash
npx wrangler d1 execute DB --local --config wrangler.jsonc \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

You should see: `artifacts`, `artifacts_fts`, `artifact_checks`, `categories`,
`clicks`, `run_locks`, `source_runs`, `sources`.

Then remotely:

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

---

## 4. Create the Pages project

```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name aiskills-hub --branch main --config wrangler.jsonc
```

First run creates the project. Note the assigned `*.pages.dev` URL.

Confirm the D1 binding is attached in the Cloudflare dashboard under
**Workers & Pages → aiskills-hub → Settings → Bindings**. The binding name must be
exactly `DB`.

---

## 5. Set the shared secret

Generate a strong random secret:

```bash
openssl rand -base64 32
```

Give it to Cloudflare:

```bash
npx wrangler pages secret put PROXY_SECRET --project-name aiskills-hub
```

Give the **same value** to GitHub Actions:

```bash
gh secret set PROXY_SECRET --repo cyalcala/skills-hub
```

> Both sides must match — this is the shared secret the pulse workflows present
> and the ingest API verifies. Never commit it. CI scans for committed secrets.

---

## 6. Set repository variables

Optional; each workflow has a default pointing at `aiskills-hub.pages.dev`. Set
these if your deployment lives elsewhere:

```bash
gh variable set INGEST_API_URL   --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/ingest"
gh variable set SCOUT_API_URL    --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/scout"
gh variable set CURATE_API_URL   --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/curate"
gh variable set VERIFY_API_URL   --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/verify-links"
gh variable set PRUNE_API_URL    --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/prune"
gh variable set TAXONOMY_API_URL --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/taxonomy"
gh variable set HEALTH_API_URL   --repo cyalcala/skills-hub --body "https://YOUR.pages.dev/api/cron/health-rollup"
```

---

## 7. Seed the sources table

The Scout has nothing to do until `sources` has rows. Insert your first three:

```bash
cd apps/web
npx wrangler d1 execute DB --remote --config wrangler.jsonc --command "
INSERT INTO sources (adapter, locator, kind, enabled, cadence_hours, notes) VALUES
  ('github-code-search', 'filename:SKILL.md path:skills', 'skill', 1, 6, 'GitHub REST code search. Authenticated, 5000 req/h.'),
  ('mcp-registry', 'https://registry.modelcontextprotocol.io/v0/servers', 'mcp', 1, 12, 'Official MCP registry, public JSON API.'),
  ('awesome-list', 'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md', 'mcp', 1, 24, 'Curated list, public raw markdown.');
"
```

Every source needs a `notes` value recording its compliance basis — see
[`DATA-POLICY.md`](DATA-POLICY.md).

---

## 8. First pulse

Trigger Scout manually in dry-run mode before trusting the schedule:

```bash
gh workflow run gha-scout-pulse.yml --repo cyalcala/skills-hub -f dry_run=true
gh run watch --repo cyalcala/skills-hub
```

Read the step summary. If `accepted` looks sane, run it for real:

```bash
gh workflow run gha-scout-pulse.yml --repo cyalcala/skills-hub
```

Then confirm rows landed:

```bash
cd apps/web
npx wrangler d1 execute DB --remote --config wrangler.jsonc \
  --command "SELECT kind, count(*) FROM artifacts GROUP BY kind;"
```

---

## 9. Custom domain (optional)

Cloudflare dashboard → **Workers & Pages → aiskills-hub → Custom domains**. Add
the domain and let Cloudflare manage DNS. Then update `PUBLIC_SITE_URL` in
`wrangler.jsonc` and the repository variables above.

---

## Rollback

Pages keeps every deployment. To revert:

```bash
npx wrangler pages deployment list --project-name aiskills-hub
```

Then promote a previous deployment from the dashboard.

**Migrations do not auto-roll-back.** D1 has no down-migrations here by design —
write a new forward migration instead. Before any destructive schema change:

```bash
npx wrangler d1 export skills-hub-db --remote --output backup-$(date +%F).sql
```

---

## Cost

The free tier covers: 5 GB D1 storage, 5 M row reads/day, 100 k writes/day,
and unlimited Pages requests with 500 builds/month.

At the projected corpus size (tens of thousands of artifacts, six scheduled
pulses per day) this stays inside the free tier. Revisit if the corpus passes
roughly 50 k artifacts — see the open question in
[`MASTER_EXECUTION_PLAN.md`](MASTER_EXECUTION_PLAN.md) §7.
