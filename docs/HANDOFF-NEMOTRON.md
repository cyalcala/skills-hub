# Handoff — implementing Skills Hub with NVIDIA Nemotron via opencode

**Audience:** an autonomous coding model (target: NVIDIA Nemotron family, driven
through [opencode](https://github.com/sst/opencode)) picking this repository up
with no prior conversation context.

**Your job:** implement phases P1 → P8 of
[`MASTER_EXECUTION_PLAN.md`](MASTER_EXECUTION_PLAN.md) against the module
contracts in [`../specs/`](../specs/).

**What is already done:** the architecture, the schema, the wire contracts, the
scoring rubric, the workflow scaffolding, and the pure-logic test suite. The
thinking is finished. What remains is implementation against fixed contracts.

---

## 0. Read this before anything else

Read these four files, in this order, before your first edit:

1. [`MASTER_EXECUTION_PLAN.md`](MASTER_EXECUTION_PLAN.md) — what and why
2. [`../specs/CAPABILITY-MAP.md`](../specs/CAPABILITY-MAP.md) — module ids and build order
3. [`../AGENTS.md`](../AGENTS.md) — repo conventions
4. The `SPEC-<module>.md` for the module you are about to touch

Do not read the whole repo. Context is a budget. The specs exist so you do not
have to reverse-engineer intent from code.

---

## 1. Environment setup

### 1.1 Point opencode at Nemotron

NVIDIA serves Nemotron over an OpenAI-compatible endpoint at
`https://integrate.api.nvidia.com/v1`. opencode reads provider config from
`opencode.json` at the repo root or `~/.config/opencode/opencode.json`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nvidia": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "NVIDIA NIM",
      "options": {
        "baseURL": "https://integrate.api.nvidia.com/v1"
      },
      "models": {
        "nvidia/llama-3.3-nemotron-super-49b-v1.5": { "name": "Nemotron Super 49B" },
        "nvidia/llama-3.1-nemotron-ultra-253b-v1": { "name": "Nemotron Ultra 253B" }
      }
    }
  }
}
```

```bash
export NVIDIA_API_KEY="nvapi-..."   # from build.nvidia.com
```

> **Verify before relying on it.** Model ids and availability on NVIDIA's
> catalog change. Confirm the exact id at <https://build.nvidia.com/models>
> and confirm opencode's current provider schema at
> <https://opencode.ai/docs/config/>. If an id 404s, that is a stale id here,
> not a broken repo. Update this file when you correct it.

### 1.2 Get the project running

```bash
npm install
cd apps/web && npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm test
```

All three must succeed before you write code. If they do not, fixing that
**is** your first task.

Cloudflare account setup is a separate, human-gated procedure — see
[`RUNBOOK-CLOUDFLARE.md`](RUNBOOK-CLOUDFLARE.md). You do not need a Cloudflare
account to do P1–P4; `--local` D1 covers it.

---

## 2. The operating loop

Repeat this loop for every task. It is deliberately small.

```
1. Pick the lowest-numbered unchecked task in tasks/todo.md whose
   dependencies are all checked.
2. Read that task's module spec section. Only that section.
3. Write the failing test FIRST. Run it. Watch it fail for the right reason.
4. Write the minimum code to pass it.
5. Run the narrowest verification: npm test -- <the one file>
6. Run the full suite: npm test
7. Commit one slice with a conventional-commit message.
8. Push.
9. Watch the CI run for that commit. If red, fix before continuing.
10. Tick the task in tasks/todo.md and append a row to
    IMPLEMENTATION_STATUS.md citing the commit hash and CI run id.
11. Go to 1.
```

**Never batch steps 1–11 across multiple tasks.** One task, one commit, one
verification, one status row. A twelve-task mega-commit that fails CI is
unbisectable and you will lose more time than you saved.

---

## 3. Hard rules

These are not stylistic. Violating one means the change gets reverted.

| # | Rule | Why |
|---|---|---|
| 1 | **Never invent a contract.** If a spec does not define a field, do not add it — open a question in `tasks/todo.md` instead. | Contracts are shared across modules. A unilateral field addition breaks the other five. |
| 2 | **Never `git push --force`, never rewrite `main` history.** | The evidence trail is the product's credibility. |
| 3 | **Never commit a secret.** Secrets go in GitHub Secrets and `wrangler pages secret put`. CI scans for this. | Obvious, and irreversible once pushed. |
| 4 | **Never delete an artifact row.** Deactivate with an `inactive_reason`. | Deletion loses the history that makes re-verification meaningful. |
| 5 | **Never write raw SQL outside `apps/web/src/lib/`.** | Index alignment can only be audited if the queries are in one place. |
| 6 | **Never mark a task done without running its verification.** "It looks right" is not evidence. | This is the single most common failure mode for autonomous runs. |
| 7 | **Never disable or weaken a failing test to make CI green.** Fix the code, or escalate. | A muted test is worse than no test. |
| 8 | **Never add a dependency without recording why** in the task's status row. | Supply chain surface. |
| 9 | **Respect `robots.txt` and API terms in every adapter.** | See [`DATA-POLICY.md`](DATA-POLICY.md). This is a legal boundary, not a preference. |
| 10 | **Keep `scoreArtifact` pure.** No clock reads, no network, no randomness. | It is golden-file tested; impurity silently breaks reproducibility. |

---

## 4. When you get stuck

Do not guess and proceed. Guessing compounds. Instead:

1. **Contract ambiguity** — the spec does not answer your question. Append the
   question to the `## Open Questions` section of the relevant spec, implement
   the most conservative reading, and note the assumption in your commit body.
2. **Failing test you did not write** — this is a real regression. Bisect it.
   Do not skip the test.
3. **External source changed shape** — an adapter's upstream broke. Set that
   source's `enabled = 0` (a data change, no deploy needed), record it, and
   move on. Do not let one dead source block the phase.
4. **Three consecutive failed attempts at the same task** — stop. Write what you
   tried and why each failed into `tasks/todo.md` under that task, and move to
   the next independent task. A human will unblock it.

---

## 5. Definition of done, per task

A task is done when **all** of these are true. This is the standing bar on top
of each task's own acceptance criteria.

- [ ] The task's acceptance criteria in `tasks/todo.md` are each satisfied
- [ ] A test exists that would fail if the change were reverted
- [ ] `npm test` passes in full, not just the new file
- [ ] No previously passing test was modified to accommodate the change
- [ ] The behavior was observed at runtime, not only in a unit test, for
      anything touching D1 or HTTP
- [ ] Any doc the change contradicts has been updated in the same commit
- [ ] CI is green on the pushed commit
- [ ] `IMPLEMENTATION_STATUS.md` has a row citing the commit hash and run id

---

## 6. Commit conventions

Conventional commits, scoped by **module id** from the capability map:

```
feat(db): add artifacts table and ordering-aligned indexes
fix(ingest): chunk batch upserts by variable count, not row count
test(enrich): cover freshness decay across the 30–365 day window
docs(ops): record ADR-004 on npm over bun
chore(pulse): stagger cron offsets off the hour
```

Body should answer *why*, not restate *what* — the diff already says what.

---

## 7. Phase-by-phase entry points

Where to start reading for each phase. Everything else is noise until you need it.

| Phase | Module | Start here | First file you will touch |
|---|---|---|---|
| P1 | `db` | [`SPEC-db.md`](../specs/SPEC-db.md) | `apps/web/src/lib/db.ts` |
| P2 | `ingest` | [`SPEC-ingest.md`](../specs/SPEC-ingest.md) | `apps/web/src/pages/api/ingest.ts` |
| P3 | `harvest` | [`SPEC-harvest.md`](../specs/SPEC-harvest.md) | `packages/harvester/src/adapters/github-code-search.ts` |
| P4 | `enrich` | [`SPEC-enrich.md`](../specs/SPEC-enrich.md) | `apps/web/src/pages/api/cron/curate.ts` |
| P5 | `verify` | [`SPEC-verify.md`](../specs/SPEC-verify.md) | `apps/web/src/pages/api/cron/verify-links.ts` |
| P6 | `web` | [`SPEC-web.md`](../specs/SPEC-web.md) | `apps/web/src/pages/index.astro` |
| P7 | `pulse` | [`SPEC-pulse.md`](../specs/SPEC-pulse.md) | `.github/workflows/gha-scout-pulse.yml` |
| P8 | — | [`MASTER_EXECUTION_PLAN.md`](MASTER_EXECUTION_PLAN.md) §5 | `docs/RUNBOOK-CLOUDFLARE.md` |

---

## 8. Known traps

Inherited from the model repo's production audit. Each one already cost someone
real debugging time. Do not rediscover them.

1. **D1 `too many SQL variables`.** Chunk by rows × columns, not rows.
   `apps/web/src/lib/ingest-batch.ts` already handles this — use it.
2. **Green CI hiding zero-row harvests.** Every pulse asserts a minimum. Do not
   remove those thresholds to make a run pass.
3. **Unaligned indexes.** An index on the filter column alone does not help a
   query that also sorts. Match `WHERE` + `ORDER BY` order.
4. **HTML payload bloat.** The model repo shipped a 1.75 MB homepage. Paginate
   server-side from the first list route you write, not later.
5. **Mixed-format dates.** Normalize to ISO-8601 UTC on write, always. Text
   dates in mixed formats sort wrong and silently.
6. **MessageChannel on Cloudflare Pages.** Already patched in
   `astro.config.mjs`. Do not remove that Vite plugin without testing a real
   deploy.
7. **Local wrangler D1 error 7403.** A known Cloudflare auth quirk. Use
   `--local` or workflow evidence for audits rather than fighting it.
8. **Silent drops reporting success.** Reject the batch loudly; never drop a row
   and report the run as clean.

---

## 9. What "self-updating and self-researching" actually requires

The phrase is the product promise. Concretely it means three loops must close,
and none of them is closed yet:

1. **Discovery loop** (Scout, P3) — new artifacts appear without a human adding
   them. Closed when a scheduled run inserts rows nobody typed.
2. **Re-evaluation loop** (Curator + Cartographer, P4) — existing artifacts get
   re-scored as they change. Closed when a score changes on its own because
   upstream changed.
3. **Decay loop** (Sentinel + Pruner, P5) — dead things leave. Closed when an
   artifact deactivates itself with a correct reason and no human touched it.

**A directory with only loop 1 is a growing pile of rot.** If you must cut
scope, cut breadth of sources — never cut loops 2 or 3.

---

## 10. Escalate to a human for

- Anything in the **Ask first** list of a module spec's Boundaries section
- Choosing or purchasing a custom domain
- Any Cloudflare account action that spends money
- A schema change after P2 has shipped to production
- Changing the quality rubric's weights (it is published; changes reorder the
  whole directory and need an ADR)
- Removal requests from a source owner (see [`DATA-POLICY.md`](DATA-POLICY.md))
