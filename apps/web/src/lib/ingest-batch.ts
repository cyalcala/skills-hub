// Batch upsert chunking.
//
// THIS FILE EXISTS BECAUSE OF A PRODUCTION BUG. The model repo
// (cyalcala/va-freelance-hub) shipped batch inserts that chunked by ROW COUNT
// and hit D1's `too many SQL variables` ceiling in production once rows grew
// enough columns. Chunk by VARIABLE COUNT — rows × columns — not by rows.
//
// Contract: specs/SPEC-ingest.md

/**
 * SQLite's compiled-in parameter ceiling is 999 in the configuration D1 uses.
 * We target 900 to leave headroom for any statement-level params the caller
 * adds (a WHERE clause, a timestamp) without recomputing the budget.
 */
export const MAX_SQL_VARIABLES = 900;

/**
 * Split `rows` into chunks that each stay under the variable ceiling.
 *
 * @param rows            items to insert
 * @param columnsPerRow   bind params each row contributes
 * @param maxVariables    ceiling; injected for testability
 *
 * Throws when a single row cannot fit — that is a schema problem, and failing
 * loudly beats emitting chunks that will be rejected downstream.
 */
export function chunkByVariableBudget<T>(
  rows: T[],
  columnsPerRow: number,
  maxVariables: number = MAX_SQL_VARIABLES,
): T[][] {
  if (columnsPerRow <= 0) {
    throw new RangeError("columnsPerRow must be greater than zero");
  }
  if (columnsPerRow > maxVariables) {
    throw new RangeError(
      `a single row needs ${columnsPerRow} variables, over the ${maxVariables} ceiling`,
    );
  }
  if (rows.length === 0) return [];

  const rowsPerChunk = Math.floor(maxVariables / columnsPerRow);
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    chunks.push(rows.slice(i, i + rowsPerChunk));
  }
  return chunks;
}

export interface BatchOutcome {
  attempted: number;
  accepted: number;
  rejected: number;
  failedChunks: number;
  errors: string[];
}

/**
 * Merge per-chunk outcomes into one reportable result.
 *
 * Counts must reflect reality. The model repo's audit found batch paths that
 * reported success totals while chunks had silently failed — which is how a
 * broken ingest stays green for weeks. A failed chunk contributes zero to
 * `accepted` and its rows land in `rejected`.
 */
export function mergeOutcomes(outcomes: BatchOutcome[]): BatchOutcome {
  return outcomes.reduce<BatchOutcome>(
    (acc, o) => ({
      attempted: acc.attempted + o.attempted,
      accepted: acc.accepted + o.accepted,
      rejected: acc.rejected + o.rejected,
      failedChunks: acc.failedChunks + o.failedChunks,
      // Cap the error list so one pathological run cannot blow up the
      // source_runs row it gets serialized into.
      errors: [...acc.errors, ...o.errors].slice(0, 20),
    }),
    { attempted: 0, accepted: 0, rejected: 0, failedChunks: 0, errors: [] },
  );
}

/** True when a run should be reported as failed rather than partial. */
export function isFailedRun(outcome: BatchOutcome, insertErrorThreshold: number): boolean {
  if (outcome.attempted === 0) return false;
  if (outcome.accepted === 0) return true; // total wipeout is never "partial"
  return outcome.failedChunks > insertErrorThreshold;
}
