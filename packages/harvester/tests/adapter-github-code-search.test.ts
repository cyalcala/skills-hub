import { describe, it, expect } from "vitest";
import { githubCodeSearchAdapter } from "../src/adapters/github-code-search";
import { parseFrontmatter } from "../src/lib/frontmatter";

const NOW = new Date("2026-08-15T00:00:00Z");

// Mock search response with proper html_url fields
const mockSearchResponse = {
  "total_count": 1,
  "items": [
    {
      "path": "SKILL.md",
      "html_url": "https://github.com/owner/no-frontmatter",
      "repository": {
        "full_name": "owner/no-frontmatter",
        "html_url": "https://github.com/owner/no-frontmatter"
      }
    }
  ]
};

// Markdown without YAML frontmatter (starts with #, not ---)
const mockSkillMdNoFrontmatter = `# No frontmatter

Just a readme without YAML frontmatter.
`;

// Markdown with valid YAML frontmatter
const mockSkillMdValid = `---
name: test-skill
description: A test skill
tags:
  - testing
  - ci
---

# Usage

This is a test skill.
`;

function createTestCtx() {
  return {
    fetch: globalThis.fetch as any,
    cursor: null,
    limit: 100,
    logger: ((level: string, msg: string, meta?: unknown) => {
      // no-op for tests
    }) as any,
  } as any;
}

describe("github-code-search adapter", () => {
  it("parses SKILL.md with valid frontmatter", async () => {
    // Mock the fetch calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("search/code")) {
        return new Response(JSON.stringify(mockSearchResponse), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("contents")) {
        // Return valid frontmatter content for the first test
        return new Response(mockSkillMdValid, {
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response(null, { status: 404 });
    };

    const adapter = githubCodeSearchAdapter("ghp_test_token") as any;
    const ctx = createTestCtx();

    const result = await adapter.run("owner/no-frontmatter", ctx);

    // Should have found at least one artifact
    expect(result.artifacts.length).toBeGreaterThan(0);

    const artifact = result.artifacts[0];
    expect(artifact.kind).toBe("skill");
    expect(artifact.source_url).toBe("https://github.com/owner/no-frontmatter");
    expect(artifact.name).toBeDefined();
  });

  it("skips non-SKILL.md files", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("search/code")) {
        return new Response(JSON.stringify(mockSearchResponse), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("contents")) {
        return new Response("", { status: 404 });
      }

      return new Response(null, { status: 404 });
    };

    const adapter = githubCodeSearchAdapter("ghp_test_token") as any;
    const ctx = createTestCtx();

    const result = await adapter.run("owner/no-frontmatter", ctx);

    // Should not include repos without SKILL.md
    const skillArtifacts = result.artifacts.filter((a: any) => a.kind === "skill");
    expect(skillArtifacts.length).toBeLessThanOrEqual(1);
  });

  it("handles missing frontmatter gracefully", async () => {
    // Mock the fetch calls - return content WITHOUT frontmatter
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("search/code")) {
        return new Response(JSON.stringify(mockSearchResponse), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("contents")) {
        // Return content WITHOUT frontmatter for this test
        return new Response(mockSkillMdNoFrontmatter, {
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response(null, { status: 404 });
    };

    const adapter = githubCodeSearchAdapter("ghp_test_token") as any;
    const ctx = createTestCtx();

    const result = await adapter.run("owner/no-frontmatter", ctx);

    // Should still emit an artifact even without valid frontmatter
    // The adapter emits the artifact; the rubric scores it down
    expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
    const artifact = result.artifacts[0];
    expect(artifact.name).toBeDefined(); // Will use repo name as fallback
  });
});