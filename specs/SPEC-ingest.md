# Spec: `ingest`

**Module id:** `ingest` · **Depends on:** `db` · **Phase:** P2 (12%)

## Objective

Own the only write path into the corpus: an authenticated HTTP API that accepts
batches of discovered artifacts, validates them, upserts them idempotently, and
records evidence of what happened. If this module is honest about its counts,
every downstream health signal is trustworthy. If it lies, nothing else matters.

## Interface ownership

This module **owns the `ArtifactInput` wire contract**, implemented in
`apps/web/src/lib/artifact-schema.ts`. Harvest adapters conform to it. Adding a
field is an interface revision that ripples to the schema, every adapter, and
the public site — not a tweak.

## Endpoints

### `POST /api/ingest`

The batch write. Called by Scout.

**Auth:** `Authorization: Bearer <PROXY_SECRET>` or `x-cron-secret`. Constant-time
compare via `src/lib/auth.ts`. Fails closed when no secret is configured.

**Request:** `IngestBody` — `{ agent, source_id?, artifacts: ArtifactInput[] }`,
max 500 artifacts per call.

**Response `200`:**
```json
{
  "ok": true,
  "runId": 412,
  "attempted": 500,
  "accepted": 487,
  "rejected": 13,
  "inserted": 302,
  "updated": 185,
  "unchanged": 13,
  "failedChunks": 0,
  "errors": []
}
```

**Response `400`:** validation failed. Body carries every `ValidationIssue`, each
with the row `index` and `field`. The whole batch is rejected — see below.

**Response `401`:** bad or missing secret. No body detail (do not help a prober).

**Response `409`:** the `ingest` run lock is held. Body reports `heldBy` and
`expiresAt`. This is a normal outcome, not an error — the caller retries later.

**Response `503`:** D1 unavailable.

### `POST /api/cron/scout`

Server-side source selection: returns the list of `sources` rows due for a run,
so the harvester CLI knows what to fetch. Read-only apart from stamping
`last_run_at`.

## Behavior contract

### Validation rejects the whole batch

A single malformed row fails the entire batch with a `400`. We do **not** accept
the good rows and silently drop the bad ones.

This is a deliberate, load-bearing choice. The model repo's audit found batch
paths that dropped rows while reporting success, which is exactly how a broken
adapter stays broken for weeks with green CI. Loud beats convenient.

### Upsert is keyed on `source_url`

```
compute content_hash over the identity fields
  ├── no row with this source_url        → INSERT, first_seen_at = now
  ├── row exists, hash UNCHANGED         → UPDATE last_seen_at ONLY  → "unchanged"
  └── row exists, hash CHANGED           → UPDATE fields + last_seen_at,
                                            clear enriched_at → "updated"
```

Clearing `enriched_at` on a real change is what queues the row for the Curator.
That is the entire mechanism by which the directory re-researches itself — do
not "optimize" it away.

A previously-deactivated artifact that reappears is **reactivated**:
`is_active = 1`, `inactive_reason = NULL`. Things come back from the dead.

### Chunking is mandatory

Use `chunkByVariableBudget` from `src/lib/ingest-batch.ts`. Chunk by
**rows × columns**, never by row count. See the comment at the top of that file
for the production incident that motivates it.

### Every call writes evidence

One `source_runs` row per call, always — including failures. `status` is `ok`,
`partial`, or `failed` per `isFailedRun`. Counts must reflect reality: a failed
chunk contributes **zero** to `accepted`.

### Locking

Acquire the `ingest` lock before writing, release in a `finally`. A run that
cannot acquire returns `409` rather than waiting — a queued Worker request
burns wall-clock and can hit the platform timeout.

## Project Structure

```
apps/web/src/pages/api/ingest.ts        → the batch endpoint
apps/web/src/pages/api/cron/scout.ts    → due-source selection
apps/web/src/lib/artifact-schema.ts     → wire contract + validation  [DONE]
apps/web/src/lib/ingest-batch.ts        → chunking + outcome merging  [DONE]
apps/web/src/lib/auth.ts                → constant-time secret check  [DONE]
apps/web/src/lib/upsert.ts              → the upsert SQL             [TODO]
apps/web/tests/artifact-schema.test.ts  → [DONE]
apps/web/tests/ingest-batch.test.ts     → [DONE]
apps/web/tests/upsert.test.ts           → [TODO]
```

## Commands

```bash
npm test -- tests/ingest-batch.test.ts tests/artifact-schema.test.ts
npm run dev   # then POST against http://localhost:4321/api/ingest
```

Local smoke:
```bash
curl -X POST http://localhost:4321/api/ingest \
  -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" \
  -d '{"agent":"scout","artifacts":[{"kind":"skill","name":"t","source_url":"https://github.com/a/b"}]}'
```

## Testing Strategy

Vitest for validation, chunking, and outcome-merging (all pure, all done).
Upsert logic needs real SQLite — integration test against `wrangler d1 --local`.

**Required regression tests:**
- A >1000-row batch chunks correctly and inserts every row exactly once
- Re-posting an identical batch yields `unchanged`, not `updated`
- A changed summary yields `updated` **and clears `enriched_at`**
- A deactivated artifact reappearing is reactivated with a cleared reason
- A partial chunk failure reports `accepted` below `attempted`, never equal
- Wrong secret returns 401; absent configured secret also returns 401

## Boundaries

- **Always:** write a `source_runs` row; release the lock in `finally`; use the
  shared chunker; return real counts.
- **Ask first:** changing the `ArtifactInput` shape; changing the batch cap;
  allowing partial-batch acceptance.
- **Never:** accept unauthenticated writes; drop a row silently; report
  `accepted` for rows that did not land; delete rows.

## Success Criteria

- [ ] A 1000-artifact batch inserts fully, chunked, in one call
- [ ] Idempotency: posting twice leaves the corpus identical, second run reports
      all `unchanged`
- [ ] A content change clears `enriched_at`
- [ ] Malformed row → `400` listing every issue with row indexes
- [ ] Bad secret → `401`; contended lock → `409`
- [ ] Every call produced exactly one `source_runs` row
- [ ] `npm test` green

## Open Questions

- Should `/api/ingest` accept gzip request bodies? Large batches over Workers
  may benefit. Deferred until a real batch size hurts.
