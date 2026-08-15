// Deterministic quality scoring.
//
// Contract: specs/SPEC-enrich.md · Human-readable: docs/QUALITY-RUBRIC.md
//
// Design rules, in priority order:
//   1. PURE. No network, no clock reads, no randomness. `now` is injected so
//      the same artifact + same `now` always yields the same score. This is
//      what makes the score auditable and the tests golden-file-able.
//   2. TRANSPARENT. Always emit a per-dimension breakdown. A score the user
//      cannot interrogate is a score they cannot trust, and this directory's
//      entire pitch is trustworthiness.
//   3. NO POPULARITY MONOCULTURE. Stars are capped at 20 of 100. A thoughtful
//      new skill must be able to out-score a stale famous one.

import type { ArtifactKind } from "./artifact-schema";

export interface ScoreInput {
  kind: ArtifactKind;
  name?: string | null;
  summary?: string | null;
  description?: string | null;
  license?: string | null;
  tags?: string[];
  install_target?: string[];
  stars?: number;
  source_updated_at?: string | null;
  /** True when the source declared parseable frontmatter with name+description. */
  has_valid_frontmatter?: boolean;
  /** True when the repo exposes a README we could read. */
  has_readme?: boolean;
  /** True when at least one usage example was detected. */
  has_examples?: boolean;
}

export interface ScoreBreakdown {
  metadata: number;
  documentation: number;
  freshness: number;
  licensing: number;
  popularity: number;
  discoverability: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  /** Short human-readable reasons, shown on the artifact detail page. */
  notes: string[];
}

/** Max points per dimension. Sums to 100. */
export const WEIGHTS: ScoreBreakdown = {
  metadata: 25,
  documentation: 25,
  freshness: 20,
  licensing: 10,
  popularity: 20,
  discoverability: 0, // reserved; folded into metadata for v1
};

const DAY_MS = 86_400_000;

/** SPDX ids we treat as unambiguously reusable. */
const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unlicense",
  "CC0-1.0",
  "MPL-2.0",
]);

/**
 * Score an artifact 0–100.
 *
 * `now` is required and injected — never call Date.now() in here. A scorer that
 * reads the clock cannot be golden-file tested and drifts silently.
 */
export function scoreArtifact(input: ScoreInput, now: Date): ScoreResult {
  const notes: string[] = [];

  // ── Metadata (25) — is this thing well-formed? ───────────────────────────
  let metadata = 0;
  if (input.has_valid_frontmatter) {
    metadata += 12;
  } else {
    notes.push("No valid frontmatter detected.");
  }
  const summaryLen = (input.summary ?? "").trim().length;
  if (summaryLen >= 40) metadata += 7;
  else if (summaryLen > 0) metadata += 3;
  else notes.push("Missing a description/summary.");

  const tagCount = input.tags?.length ?? 0;
  if (tagCount >= 3) metadata += 4;
  else if (tagCount > 0) metadata += 2;

  if ((input.install_target?.length ?? 0) > 0) metadata += 2;
  metadata = clamp(metadata, 0, WEIGHTS.metadata);

  // ── Documentation (25) — can someone actually use it? ────────────────────
  let documentation = 0;
  if (input.has_readme) documentation += 10;
  else notes.push("No README found.");
  if (input.has_examples) documentation += 8;
  else notes.push("No usage examples detected.");

  const descLen = (input.description ?? "").trim().length;
  if (descLen >= 800) documentation += 7;
  else if (descLen >= 250) documentation += 4;
  else if (descLen > 0) documentation += 2;
  documentation = clamp(documentation, 0, WEIGHTS.documentation);

  // ── Freshness (20) — decays continuously, no cliff edges. ────────────────
  let freshness = 0;
  const ageDays = daysSince(input.source_updated_at, now);
  if (ageDays === null) {
    freshness = 4; // unknown is not the same as stale; partial credit
    notes.push("Upstream last-modified date unknown.");
  } else if (ageDays <= 30) {
    freshness = 20;
  } else if (ageDays <= 365) {
    // Linear decay 20 → 5 across the 30–365 day window.
    freshness = Math.round(20 - ((ageDays - 30) / 335) * 15);
  } else if (ageDays <= 730) {
    freshness = 3;
    notes.push("Not updated in over a year.");
  } else {
    freshness = 0;
    notes.push("Not updated in over two years.");
  }
  freshness = clamp(freshness, 0, WEIGHTS.freshness);

  // ── Licensing (10) — can you legally reuse it? ───────────────────────────
  let licensing = 0;
  const license = (input.license ?? "").trim();
  if (license && license !== "NOASSERTION") {
    licensing = PERMISSIVE.has(license) ? 10 : 6;
    if (!PERMISSIVE.has(license)) notes.push(`License "${license}" may restrict reuse.`);
  } else {
    notes.push("No license declared — reuse rights are unclear.");
  }

  // ── Popularity (20) — capped and logarithmic on purpose. ─────────────────
  // Linear stars would let one viral repo dominate every list forever. log10
  // compresses the tail: 10 stars ≈ 5, 100 ≈ 10, 1000 ≈ 15, 10k+ ≈ 20.
  const stars = Math.max(0, input.stars ?? 0);
  const popularity = clamp(Math.round(Math.log10(stars + 1) * 5), 0, WEIGHTS.popularity);

  const breakdown: ScoreBreakdown = {
    metadata,
    documentation,
    freshness,
    licensing,
    popularity,
    discoverability: 0,
  };

  const score = clamp(
    metadata + documentation + freshness + licensing + popularity,
    0,
    100,
  );

  return { score, breakdown, notes };
}

/** Whole days between an ISO-8601 timestamp and `now`. Null when unparseable. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const delta = now.getTime() - then;
  // A future timestamp means upstream clock skew or a bad parse. Treat as fresh
  // rather than awarding a nonsensical negative age.
  if (delta < 0) return 0;
  return Math.floor(delta / DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
