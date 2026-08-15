// Artifact kinds and install targets for the harvester.
//
// Contract: specs/SPEC-harvest.md
// Harvest adapters produce ArtifactInput rows that flow into the ingest API.

export const ARTIFACT_KINDS = ["skill", "mcp", "ruleset", "subagent", "command"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const INSTALL_TARGETS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "opencode",
  "windsurf",
  "zed",
  "continue",
  "generic",
] as const;
export type InstallTarget = (typeof INSTALL_TARGETS)[number];