// Inactive reason derivation and safety checks.
//
// Contract: specs/SPEC-verify.md
//
// Derives the inactive reason from observation history and checks the safety
// ratio before deactivation.

import { classifyObservation, deriveInactiveReason, type ObservationVerdict } from "./verify-attempt";

/** Maximum percentage of candidates that Pruner may deactivate without blocking. */
export const MAX_PRUNE_RATIO_PCT = 10;

/**
 * Derive the inactive reason from a list of observations for a single artifact.
 * 
 * @param observations List of artifact_checks entries for this artifact
 * @param lastSeenAt When the artifact was last seen by a harvest
 * @returns { reason, isTerminal, shouldPrune }
 */
export function getInactiveReasonFromChecks(
  observations: Array<{ http_status: number; latency_ms?: number; reason?: string }>,
  lastSeenAt: string | null,
): { reason: string | null; isTerminal: boolean; consecutiveTransients: number } {
  // Classify each observation
  let consecutiveTransients = 0;
  let lastVerdict: ObservationVerdict = "ok";
  
  for (const obs of observations) {
    const verdict = classifyObservation(obs);
    
    if (verdict === "ok") {
      consecutiveTransients = 0;
      lastVerdict = "ok";
    } else if (verdict === "transient") {
      consecutiveTransients++;
      lastVerdict = "transient";
    } else if (verdict === "terminal") {
      // Terminal failure - immediately deactivate
      const { reason } = deriveInactiveReason(verdict, consecutiveTransients, 
        lastSeenAt ? Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 86400000) : null);
      return { reason, isTerminal: true, consecutiveTransients };
    }
  }
  
  // After processing all observations, derive the reason
  const { reason, isTerminal } = deriveInactiveReason(
    lastVerdict, 
    consecutiveTransients, 
    lastSeenAt ? Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 86400000) : null
  );
  
  return { reason, isTerminal, consecutiveTransients };
}

/**
 * Check the safety ratio before pruning.
 * If candidates exceed MAX_PRUNE_RATIO_PCT of the live corpus, pruning is blocked.
 * 
 * @param candidateCount Number of artifacts candidates for deactivation
 * @param liveCorpusSize Number of currently active artifacts
 * @returns { blocked, ratioPct }
 */
export function checkSafetyRatio(candidateCount: number, liveCorpusSize: number): { blocked: boolean; ratioPct: number } {
  if (liveCorpusSize === 0) {
    return { blocked: false, ratioPct: 0 };
  }
  
  const ratioPct = Math.round((candidateCount / liveCorpusSize) * 100);
  const blocked = ratioPct > MAX_PRUNE_RATIO_PCT;
  
  return { blocked, ratioPct };
}