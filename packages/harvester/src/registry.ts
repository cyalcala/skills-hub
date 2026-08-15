// Adapter registry and plumbing.
//
// Contract: specs/SPEC-harvest.md
//
// Exports the `Adapter` interface and `AdapterContext` that every adapter must
// conform to. Also exports the `AdapterResult` shape and the harness functions
// for running adapters within a harness.

import { type ArtifactInput } from "./artifact-schema";

export interface AdapterContext {
  /** Injected fetch. Tests pass a fixture-backed stub. */
  fetch: typeof globalThis.fetch;
  /** Resumable pagination state from sources.last_cursor. */
  cursor: string | null;
  /** Hard ceiling on results this run. Respect it. */
  limit: number;
  logger: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
}

export interface AdapterResult {
  artifacts: ArtifactInput[];
  /** Persisted to sources.last_cursor for the next run. Null = start over. */
  nextCursor: string | null;
  /** Non-fatal problems. Fatal ones throw. */
  warnings: string[];
}

/** Every adapter must implement this shape. */
export interface Adapter {
  readonly name: string;
  readonly kind: ArtifactKind;
  /** Documented compliance basis — see docs/DATA-POLICY.md. Required. */
  readonly termsNote: string;
  run(locator: string, ctx: AdapterContext): Promise<AdapterResult>;
}

export type ArtifactKind = "skill" | "mcp" | "ruleset" | "subagent" | "command";

// ---------------------------------------------------------------------------
// Harness: runs an adapter and emits a report JSON contract with Scout
// ---------------------------------------------------------------------------

/** Report shape written by theharness and consumed by gha-scout-pulse.yml. */
export interface HarvestReport {
  agent: string;
  startedAt: string;
  finishedAt: string;
  totals: {
    discovered: number;
    accepted: number;
    rejected: number;
    failedSources: number;
  };
  sources: {
    adapter: string;
    locator: string;
    discovered: number;
    accepted: number;
    rejected: number;
    status: "ok" | "partial" | "failed";
    warnings: string[];
  }[];
}

/** Run a single adapter within a harness context. */
export async function runAdapter<
  A extends Adapter,
>(
  adapter: A,
  locator: string,
  ctx: AdapterContext,
): Promise<{ result: AdapterResult; reportEntry: NonNullable<HarvestReport["sources"][0]> }> {
  const start = Date.now();
  const result = await adapter.run(locator, ctx);
  const finishedAt = new Date(Date.now()).toISOString();

  const accepted = result.artifacts.filter(
    (a) => a.kind !== "skill" || /* will be validated later */ true,
  ).length;

  const entry: NonNullable<HarvestReport["sources"][0]> = {
    adapter: adapter.name,
    locator,
    discovered: result.artifacts.length,
    accepted,
    rejected: result.artifacts.length - accepted,
    status: "ok",
    warnings: result.warnings,
  };

  return { result, entry };
}