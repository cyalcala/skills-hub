# Spec: `pulse`

**Module id:** `pulse` · **Depends on:** `harvest`, `enrich`, `verify` · **Phase:** P7 (8%)

## Objective

Orchestrate the six agents on schedule, and — more importantly — **make failure
loud**. A scheduler that runs reliably while the work inside it silently does
nothing is worse than no scheduler, because it manufactures false confidence.

## The six workflows

| Agent | File | Cron (UTC) | Permissions |
|---|---|---|---|
| 🔭 Scout | `gha-scout-pulse.yml` | `17 */6 * * *` | `contents: read` |
| 📚 Curator | `gha-curator-pulse.yml` | `23 3 * * *` | `contents: read` |
| 🛡️ Sentinel | `gha-sentinel-pulse.yml` | `41 5 * * *` | `contents: read` |
| ✂️ Pruner | `gha-pruner-pulse.yml` | `13 4 * * 1` | `contents: read` |
| 🗺️ Cartographer | `gha-cartographer-pulse.yml` | `37 6 * * 1` | `contents: read` |
| 📜 Chronicler | `gha-chronicler-pulse.yml` | `51 7 * * 1` | `contents: **write**` |

Chronicler is the only one with write access, because it commits the rollup. A
compromised adapter therefore cannot rewrite the repository.

Cron minutes are staggered and offset off the hour: `:00` is the most contended
slot on GitHub's shared runners and gets queued.

## Structural rules

Every pulse workflow has the same skeleton. `gha-scout-pulse.yml` is the
reference implementation; mirror changes across all six.

1. **`concurrency` group per agent, `cancel-in-progress: false`.** A partially
   complete harvest killed mid-batch leaves worse state than one that finishes
   late.
2. **Preflight secret check.** Fail in ten seconds with a clear message rather
   than at minute twenty with a confusing 401.
3. **Explicit failure thresholds as `env`**, so they are visible and tunable
   without reading the script body.
4. **A `$GITHUB_STEP_SUMMARY` table** on every run. The summary is the operator
   UI; a run whose outcome requires reading raw logs is a run nobody checks.
5. **Evidence uploaded with `if: always()`**, 14-day retention (30 for Pruner).
6. **Every agent takes its run lock** and releases it in a `finally`.

## Failure thresholds

The heart of this module. Each is set so that the *silent* failure is caught.

| Agent | Guard | Rationale |
|---|---|---|
| Scout | `MIN_TOTAL_ACCEPTED=1` | Zero accepted across every source means the adapters are broken, not that the internet ran out of skills |
| Scout | `SOURCE_FAILURE_FAIL_THRESHOLD=3` | Tolerate a few dead sources, not a systemic outage |
| Curator | `ENRICH_ERROR_FAIL_THRESHOLD=10` | No minimum floor — a zero-work run is genuinely healthy here |
| Sentinel | `MAX_FAILURE_RATIO_PCT=40` | >40% failing means our egress broke, not the whole web |
| Pruner | `MAX_PRUNE_RATIO_PCT=10` | A prune that big is a bug, not a cleanup |
| Cartographer | zero categories fails | Rebuilding the taxonomy to nothing is not success |

**Do not raise a threshold to make a red run green.** That inverts the entire
point of having them. Fix the cause, or change it deliberately with a note in
`IMPLEMENTATION_STATUS.md`.

## Report contracts

Each agent's report JSON is the interface between its script and its workflow's
`jq` expressions. The shapes are defined in the owning module's spec —
[`SPEC-harvest.md`](SPEC-harvest.md) for Scout, [`SPEC-enrich.md`](SPEC-enrich.md)
for Curator and Cartographer, [`SPEC-verify.md`](SPEC-verify.md) for Sentinel
and Pruner.

Changing a report shape means changing the workflow's `jq` in the same commit.
Otherwise `jq` evaluates the missing field to its `// 0` default and the pulse
either fails confusingly or, worse, passes while measuring nothing.

## Configuration

**Repository secrets:** `PROXY_SECRET` (shared ingest secret).
`GITHUB_TOKEN` is provided automatically.

**Repository variables** (optional; each workflow has a sane default):
`INGEST_API_URL`, `SCOUT_API_URL`, `CURATE_API_URL`, `VERIFY_API_URL`,
`PRUNE_API_URL`, `TAXONOMY_API_URL`, `HEALTH_API_URL`.

Using variables rather than hardcoded URLs is what lets a fork or a staging
deploy work without editing six files.

## Manual dispatch

Every workflow exposes `workflow_dispatch`. Destructive ones default to safe:
Pruner's `dry_run` defaults to **true** on manual dispatch and false on
schedule. Scout offers `--adapter` to run a single source when debugging.

## Testing Strategy

Workflows are not unit-testable. Verification is operational:

- Each workflow runs green via manual dispatch before its schedule is trusted
- A deliberately broken adapter causes exactly one source to fail, not the run
- A deliberately zeroed harvest **fails** Scout (proving the guard works) —
  this test is mandatory, since it validates the guard rather than the pipeline
- Pruner dry run writes nothing
- Lint all six with `actionlint` in CI

## Boundaries

- **Always:** set concurrency; preflight secrets; write a step summary; upload
  evidence; mirror structural changes across all six.
- **Ask first:** changing any threshold; changing a cron cadence; granting write
  permission to a workflow other than Chronicler.
- **Never:** raise a threshold to turn a run green; hardcode a secret; use
  `cancel-in-progress: true` on a write-path pulse; let a workflow pass while
  its report is missing.

## Success Criteria

- [ ] All six run green on schedule for one full week
- [ ] `source_runs` is populated by every agent
- [ ] The zeroed-harvest test fails Scout as designed
- [ ] Chronicler commits a rollup that matches the live database
- [ ] No workflow other than Chronicler holds write permission
- [ ] `actionlint` clean

## Open Questions

- Alerting. Right now a failed pulse is visible only as a red badge. A Discord
  or email webhook on failure is probably warranted before launch, but adding it
  now means another secret to manage. Deferred to P8.
