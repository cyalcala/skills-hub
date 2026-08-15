import { describe, it, expect } from "vitest";
import {
  chunkByVariableBudget,
  mergeOutcomes,
  isFailedRun,
  MAX_SQL_VARIABLES,
  type BatchOutcome,
} from "../src/lib/ingest-batch";

// Regression suite for the `too many SQL variables` failure that hit the model
// repo in production. The load-bearing assertion is the >1000-row case below.

describe("chunkByVariableBudget", () => {
  it("returns nothing for an empty input", () => {
    expect(chunkByVariableBudget([], 10)).toEqual([]);
  });

  it("keeps every chunk under the variable ceiling", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => i);
    const columnsPerRow = 27;
    const chunks = chunkByVariableBudget(rows, columnsPerRow);

    for (const chunk of chunks) {
      expect(chunk.length * columnsPerRow).toBeLessThanOrEqual(MAX_SQL_VARIABLES);
    }
  });

  it("preserves every row exactly once and in order", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => i);
    const chunks = chunkByVariableBudget(rows, 27);
    expect(chunks.flat()).toEqual(rows);
  });

  it("scales chunk size down as rows get wider", () => {
    const rows = Array.from({ length: 500 }, (_, i) => i);
    const narrow = chunkByVariableBudget(rows, 5);
    const wide = chunkByVariableBudget(rows, 90);
    // Wider rows means fewer per statement, hence more statements.
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("fits everything in one chunk when the batch is small", () => {
    expect(chunkByVariableBudget([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("rejects a row too wide to ever fit", () => {
    expect(() => chunkByVariableBudget([1], MAX_SQL_VARIABLES + 1)).toThrow(RangeError);
  });

  it("rejects a nonsensical column count", () => {
    expect(() => chunkByVariableBudget([1], 0)).toThrow(RangeError);
  });
});

const outcome = (o: Partial<BatchOutcome> = {}): BatchOutcome => ({
  attempted: 0,
  accepted: 0,
  rejected: 0,
  failedChunks: 0,
  errors: [],
  ...o,
});

describe("mergeOutcomes", () => {
  it("sums counts across chunks", () => {
    const merged = mergeOutcomes([
      outcome({ attempted: 10, accepted: 10 }),
      outcome({ attempted: 10, accepted: 7, rejected: 3, failedChunks: 1, errors: ["boom"] }),
    ]);
    expect(merged).toEqual({
      attempted: 20,
      accepted: 17,
      rejected: 3,
      failedChunks: 1,
      errors: ["boom"],
    });
  });

  it("caps the error list so one bad run cannot bloat its evidence row", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => outcome({ errors: [`e${i}`] }));
    expect(mergeOutcomes(noisy).errors).toHaveLength(20);
  });

  it("is identity-safe on an empty list", () => {
    expect(mergeOutcomes([])).toEqual(outcome());
  });
});

describe("isFailedRun", () => {
  it("treats a total wipeout as failed even when the threshold is generous", () => {
    // This is the silent-failure guard: attempted work, accepted nothing.
    expect(isFailedRun(outcome({ attempted: 100, accepted: 0, failedChunks: 4 }), 999)).toBe(true);
  });

  it("does not flag a run that had nothing to do", () => {
    expect(isFailedRun(outcome(), 0)).toBe(false);
  });

  it("respects the failed-chunk threshold when some rows landed", () => {
    const partial = outcome({ attempted: 100, accepted: 90, failedChunks: 1 });
    expect(isFailedRun(partial, 0)).toBe(true);
    expect(isFailedRun(partial, 1)).toBe(false);
  });
});
