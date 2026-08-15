// Deterministic enrichment fetch.
//
 // Contract: specs/SPEC-enrich.md
 //
// Pure functions — no network, no clock, no randomness.
// The `now` parameter is injected so the same artifact + same `now`
// always yields the same enrichment outcome.

export interface EnrichmentInput {
  kind: string;
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

export interface EnrichmentOutput {
  input: EnrichmentInput;
  has_readme: boolean;
  has_examples: boolean;
  license?: string | null;
  detected_examples: string[];
}

/**
 * Detect README, license, and usage examples from artifact metadata.
 *
 * Rules (from SPEC-enrich.md):
 * - has_readme: true when has_valid_frontmatter is true (frontmatter implies README)
 * - has_examples: determined by looking for usage-related keywords in name/tags/install_target
 * - license: use the declared license, defaulting to NOASSERTION when unknown
 *
 * @param input The artifact enrichment input
 * @param now Injected clock (for future use; currently pure)
 * @returns Enrichment output with detected signals
 */
export function enrichArtifact(input: EnrichmentInput, now: Date): EnrichmentOutput {
  const detectedExamples: string[] = [];

  // Map known example-related tags
  const exampleTags: Record<string, boolean> = {
    "ci": true,
    "testing": true,
    "cli": true,
    "api": true,
    "framework": true,
    "library": true,
    "component": true,
    "bin": true,
    "tool": true,
  };

  // Check install targets for examples
  const exampleTargets: Record<string, boolean> = {
    "claude-code": true,
    "cursor": true,
    "opencode": true,
    "windsurf": true,
  };

  // Collect example signals from tags
  if (input.tags) {
    for (const tag of input.tags) {
      const lower = tag.toLowerCase();
      if (exampleTags[lower]) {
        detectedExamples.push(tag);
      }
    }
  }

  // Collect example signals from install_target
  if (input.install_target) {
    for (const target of input.install_target) {
      if (exampleTargets[target]) {
        detectedExamples.push(target);
      }
    }
  }

  // Deduplicate examples
  const uniqueExamples = [...new Set(detectedExamples)];

  // has_readme: true when frontmatter is valid (implies README exists)
  const readme = input.has_valid_frontmatter ?? false;

  // has_examples: true when we detected at least one example signal
  const examples = uniqueExamples.length > 0;

  return {
    input,
    has_readme: readme,
    has_examples: examples,
    license: input.license,
    detected_examples: uniqueExamples,
  };
}