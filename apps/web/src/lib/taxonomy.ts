// Deterministic keyword-and-signal mapping to category slugs.
//
// Contract: specs/SPEC-enrich.md
//
// The Cartographer then recounts artifact_count from scratch, weekly.
// Counts are never incremented ad hoc anywhere else — incremental counters
// drift, and a wrong count on a category page is the kind of small lie that
// erodes trust in the whole index.

export type CategorySlug =
  | "skill"
  | "mcp"
  | "ruleset"
  | "subagent"
  | "command"
  | "uncategorized";

/**
 * Map signals to category slugs.
 * An artifact can hold multiple categories; one is enough;
 * zero routes it to `uncategorized`, which is a visible bucket.
 */
export function mapToCategories(
  kind: string,
  tags: string[],
  install_target: string[],
  name: string,
): CategorySlug[] {
  const categories: CategorySlug[] = [];

  // Map kind to category
  const kindMap: Record<string, CategorySlug> = {
    skill: "skill",
    mcp: "mcp",
    ruleset: "ruleset",
    subagent: "subagent",
    command: "command",
  };

  const kindCategory = kindMap[kind];
  if (kindCategory) {
    categories.push(kindCategory);
  }

  // Map tags to categories
  const tagCategories: Record<string, CategorySlug> = {
    "ci": "skill",
    "testing": "skill",
    "quality": "skill",
    "deployment": "skill",
    "mcp": "mcp",
    "server": "mcp",
    "integration": "skill",
    "framework": "skill",
    "cli": "skill",
    "api": "skill",
  };

  for (const tag of tags) {
    const mapped = tagCategories[tag.toLowerCase()];
    if (mapped && !categories.includes(mapped)) {
      categories.push(mapped);
    }
  }

  // Map install_target to categories
  const installTargetCategories: Record<string, CategorySlug> = {
    "claude-code": "skill",
    "cursor": "skill",
    "opencode": "skill",
    "windsurf": "skill",
    "zed": "skill",
    "continue": "skill",
    "generic": "skill",
  };

  for (const target of install_target) {
    const mapped = installTargetCategories[target];
    if (mapped && !categories.includes(mapped)) {
      categories.push(mapped);
    }
  }

  // If no categories matched, use uncategorized
  if (categories.length === 0) {
    categories.push("uncategorized");
  }

  // Deduplicate
  return [...new Set(categories)];
}

export { CategorySlug, mapToCategories };