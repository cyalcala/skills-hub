// Classification of HTTP observations into terminal vs transient failures.
//
// Contract: specs/SPEC-verify.md
//
// Determines whether an observation is `ok`, `terminal`, or `transient`.
// Classification is a pure function - no network, no clock, no randomness.

export type ObservationVerdict = "ok" | "terminal" | "transient";

export interface Observation {
  http_status: number;
  latency_ms?: number;
  reason?: string;
}

/**
 * Classify a single HTTP observation.
 * 
 * Rules (from SPEC-verify.md):
 * - 2xx → ok (alive)
 * - 301/302 → ok (alive; record final URL in reason)
 * - 404, 410 → terminal (gone)
 * - 403 → transient (often rate limiting or UA block, not deletion)
 * - 429, 5xx, timeout, DNS failure → transient
 *
 * @param observation The HTTP observation to classify
 * @returns The verdict: "ok", "terminal", or "transient"
 */
export function classifyObservation(observation: Observation): ObservationVerdict {
  const status = observation.http_status;

  // Success statuses
  if (status >= 200 && status < 300) {
    return "ok";
  }

  // Redirects considered alive
  if (status >= 300 && status < 400) {
    return "ok";
  }

  // Terminal failures - one observation is sufficient
  if (status === 404 || status === 410) {
    return "terminal";
  }

  // Transient failures
  if (status === 403 || status === 429 || status >= 500) {
    return "transient";
  }

  // Default: treat unknown statuses as transient
  return "transient";
}

/**
 * Derive the inactive reason from a classification result.
 * 
 * Rules (from SPEC-verify.md):
 * - `gone`: One terminal failure (404/410)
 * - `unreachable`: Three consecutive transient failures across three separate runs
 * - `stale`: last_seen_at older than 180 days — no harvest has seen it since
 * - `superseded`: A duplicate resolved to a preferred upstream artifact
 * 
 * Note: `unreachable` requires three *separate runs*, not three retries inside one.
 * A single bad afternoon must not prune anything.
 */
export function deriveInactiveReason(
  verdict: ObservationVerdict,
  consecutiveTransients: number,
  lastSeenAtDaysOld: number | null
): { reason: string | null; isTerminal: boolean } {
  let reason: string | null = null;
  let isTerminal = false;

  switch (verdict) {
    case "terminal":
      reason = "gone";
      isTerminal = true;
      break;
    case "transient":
      // Consecutive transients determine if we prune
      if (consecutiveTransients >= 3) {
        reason = "unreachable";
      } else {
        // Not enough consecutive transients yet
        reason = null;
      }
      break;
    case "ok":
      // Success resets the consecutive counter
      reason = null;
      break;
  }

  // Check staleness independently - if last_seen_at is older than 180 days
  if (lastSeenAtDaysOld > 180 && !reason) {
    // Staleness is a separate reason; if we already have a reason,
    // we keep the existing one (terminal takes priority over stale)
    if (!reason) {
      reason = "stale";
    }
  }

  return { reason, isTerminal };
}

export { ObservationVerdict, Observation, classifyObservation, deriveInactiveReason };