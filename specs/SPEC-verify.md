# Spec: `verify`

**Module id:** `verify` · **Depends on:** `db` · **Phase:** P5 (10%)

## Objective

Close the decay loop: notice when an indexed artifact has died, and remove it
from the live directory with a stated reason. Without this the corpus becomes a
graveyard with good SEO — which is precisely the failure mode this project
exists to avoid.

Split across two agents, deliberately:

- **Sentinel** *detects*. It records observations and changes nothing else.
- **Pruner** *decides*. It reads recorded evidence and deactivates.

That separation means a network blip during one Sentinel run can never cascade
into mass deactivation. Detection and consequence are never in the same
transaction.

## Sentinel

### Selection
The N oldest-checked **active** artifacts per run, default 300. Never the whole
corpus — a full sweep is slow, rude to hosts, and unnecessary when checks are
continuously rotating.

### Checking
- `HEAD` first; fall back to `GET` when a host rejects `HEAD` (many do).
- Timeout 10s. Follow at most 3 redirects.
- Concurrency capped at 4 per host, same politeness rules as `harvest`.
- Record every attempt in `artifact_checks`: status, `ok`, latency, reason.

### Classification

| Observation | Class | Meaning |
|---|---|---|
| 2xx | `ok` | Alive |
| 301/302 → 2xx | `ok` | Alive; record the final URL in the reason for review |
| 404, 410 | **terminal** | Gone. One observation is sufficient. |
| 403 | **transient** | Often rate limiting or a UA block, not deletion |
| 429, 5xx, timeout, DNS failure | **transient** | Our problem or theirs, temporarily |

The terminal/transient distinction is the safety mechanism. A 404 is a fact; a
503 is a mood.

### Run-level circuit breaker
If more than 40% of checks in one run fail, the run **fails loudly and records
nothing conclusive**. That ratio means our egress is broken or a deploy went
bad — not that half the internet vanished. Enforced in the workflow.

## Pruner

### Deactivation rules

Runs weekly, reads `artifact_checks`, writes `is_active = 0` plus a required
`inactive_reason`:

| Reason | Condition |
|---|---|
| `gone` | One terminal failure (404/410) |
| `unreachable` | Three consecutive transient failures across three separate runs |
| `stale` | `last_seen_at` older than 180 days — no harvest has seen it since |
| `superseded` | A duplicate resolved to a preferred upstream artifact |

`unreachable` requires three *separate runs*, not three retries inside one. A
single bad afternoon must not prune anything.

### Safety ratio
If the candidate set exceeds **10% of the live corpus**, Pruner refuses,
reports `blockedBySafetyRatio: true`, and fails the workflow. A prune that large
is a bug, not a cleanup.

### Never delete
`is_active = 0` only. Rows stay forever. A deactivated artifact that Scout sees
again is **reactivated** with its reason cleared — things come back from the
dead, and the schema's CHECK constraint enforces that an inactive row always
carries a reason.

Retention: `artifact_checks` keeps 90 days; Pruner trims older rows in the same
run.

## Endpoints

### `POST /api/cron/verify-links`
Body `{ batchSize?: number }` → `{ "checked": 300, "ok": 291, "failed": 9 }`

### `POST /api/cron/prune`
Body `{ dryRun?: boolean, maxRatioPct?: number }` →
```json
{
  "candidates": 42, "deactivated": 42, "blockedBySafetyRatio": false,
  "byReason": { "gone": 18, "unreachable": 9, "stale": 15 },
  "checksTrimmed": 1204
}
```
`dryRun` defaults to **true** on manual dispatch and false on schedule. The
dangerous default is the safe one.

## Project Structure

```
apps/web/src/lib/verify-attempt.ts          → classify one observation  [TODO]
apps/web/src/lib/inactive-reason.ts         → reason derivation         [TODO]
apps/web/src/lib/prune-query.ts             → candidate selection SQL   [TODO]
apps/web/src/pages/api/cron/verify-links.ts → Sentinel endpoint         [TODO]
apps/web/src/pages/api/cron/prune.ts        → Pruner endpoint           [TODO]
apps/web/tests/verify-attempt.test.ts       → [TODO]
apps/web/tests/inactive-reason.test.ts      → [TODO]
```

Classification and reason derivation are **pure functions** taking an
observation list and returning a verdict. Keep them pure — that is what makes
the decay rules testable without a network or a database.

## Testing Strategy

- 404 classifies terminal; 503 classifies transient
- Two transient failures do **not** deactivate; the third does
- A success between failures resets the consecutive counter
- Candidate set over 10% sets `blockedBySafetyRatio` and deactivates nothing
- `dryRun` writes nothing at all
- A reactivated artifact has `inactive_reason` cleared to NULL
- Trim removes checks older than 90 days and keeps newer ones

## Boundaries

- **Always:** record every check; require a reason on deactivation; honor the
  safety ratio; keep classification pure.
- **Ask first:** changing the staleness threshold, the consecutive-failure
  count, or the safety ratio.
- **Never:** delete an artifact row; let Sentinel deactivate anything; deactivate
  on a single transient failure; prune when the circuit breaker tripped.

## Success Criteria

- [ ] A deliberately-broken URL is detected, then deactivated as `gone` on the
      next Pruner run, with no human involvement
- [ ] A flapping URL survives two failures and deactivates on the third
- [ ] Dry run reports candidates and writes nothing
- [ ] The safety ratio blocks an artificially large candidate set
- [ ] A reactivated artifact clears its reason
- [ ] `npm test` green

## Open Questions

- Should `gone` artifacts stay publicly visible on a dedicated archive page
  rather than disappearing? A dead-link record has genuine research value, and
  we already keep the row. Leaning yes, post-launch.
