// YAML frontmatter parser for SKILL.md files.
//
// Contract: specs/SPEC-harvest.md
// - Pure function: no network, no randomness
// - Returns parsed fields or defaults when frontmatter is missing/unparseable
// - Missing frontmatter is NOT a rejection — the adapter emits the artifact
//   with has_valid_frontmatter: false and lets the rubric score it down

import { type ArtifactInput } from "../registry";

export interface FrontmatterResult {
  name: string | null;
  description: string | null;
  hasValidFrontmatter: boolean;
}

/**
 * Parse YAML frontmatter from a string.
 * Frontmatter is expected at the start of the content, bounded by `---` delimiters.
 * 
 * @param content The file content (typically README or SKILL.md file body)
 * @returns Parsed result with extracted fields
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  // Check if content starts with YAML frontmatter
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {
      name: null,
      description: null,
      hasValidFrontmatter: false,
    };
  }

  // Find the closing ---
  const firstDelim = content.indexOf("\n---");
  if (firstDelim < 0) {
    // Try with \r\n
    const winDelim = content.indexOf("\r\n---\r\n");
    if (winDelim < 0) {
      return {
        name: null,
        description: null,
        hasValidFrontmatter: false,
      };
    }
    // Parse from after the second ---
    const body = content.substring(winDelim + "\r\n---\r\n".length);
    return parseFrontmatterBody(body);
  }

  const body = content.substring(firstDelim + "\n---".length);
  return parseFrontmatterBody(body);
}

function parseFrontmatterBody(body: string): FrontmatterResult {
  const result: Record<string, unknown> = {};
  const lines = body.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      // End of frontmatter
      break;
    }
    if (trimmed === "") continue;
    
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    
    const key = trimmed.substring(0, colonIdx).trim();
    const value = trimmed.substring(colonIdx + 1).trim();
    
    // Parse YAML value
    let parsedValue: unknown;
    
    if (value.startsWith('"') && value.endsWith('"')) {
      parsedValue = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      parsedValue = value.slice(1, -1);
    } else if (value.toLowerCase() === "true") {
      parsedValue = true;
    } else if (value.toLowerCase() === "false") {
      parsedValue = false;
    } else if (value === "") {
      parsedValue = null;
    } else {
      try {
        parsedValue = Number(value);
      } catch {
        parsedValue = value;
      }
    }
    
    result[key] = parsedValue;
  }

  const name: string | null = result.name !== undefined ? String(result.name) : null;
  const description: string | null = result.description !== undefined ? String(result.description) : null;
  
  // Valid frontmatter has both name and description
  const hasValidFrontmatter = name !== null && description !== null;

  return {
    name,
    description,
    hasValidFrontmatter,
  };
}

export { parseFrontmatter };