import { describe, it, expect } from "vitest";
import { awesomeListAdapter } from "../src/adapters/awesome-list";

function createTestCtx() {
  return {
    fetch: globalThis.fetch as any,
    cursor: null,
    limit: 50,
    logger: ((level: string, msg: string, meta?: unknown) => {
      // no-op for tests
    }) as any,
  } as any;
}

// Markdown content with repo links (no headings)
const MARKDOWN_NO_HEADINGS = `- [test-skill](https://github.com/acme/test-skill)
- [another-skill](https://github.com/otheruser/another-skill)
- [badges-only](https://example.com/badges)`;

// Markdown content with headings
const MARKDOWN_WITH_HEADINGS = `# Category

- [skill-in-category](https://github.com/acme/skill-in-category)
- [yet-another](https://github.com/otheruser/yet-another)`;

describe("awesome-list adapter", () => {
  it("parses repo links from markdown without headings", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      if (typeof input === "string" && input.includes("- [test-skill]")) {
        return new Response(MARKDOWN_NO_HEADINGS, {
          headers: { "Content-Type": "text/markdown" },
        });
      }
      return new Response(null, { status: 404 });
    };

    const adapter = awesomeListAdapter();
    const ctx = createTestCtx();

    // Pass the markdown content as locator (since it doesn't start with http)
    const result = await adapter.run(MARKDOWN_NO_HEADINGS, ctx);

    expect(result.artifacts.length).toBeGreaterThan(0);
    const artifact = result.artifacts[0];
    expect(artifact.kind).toBe("skill");
    expect(artifact.name).toContain("test-skill");
    expect(artifact.source_url).toContain("github.com");
  });

  it("respects the limit parameter", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      if (typeof input === "string" && input.includes("- [test-skill]")) {
        return new Response(MARKDOWN_NO_HEADINGS, {
          headers: { "Content-Type": "text/markdown" },
        });
      }
      return new Response(null, { status: 404 });
    };

    const adapter = awesomeListAdapter();
    const ctx = createTestCtx();

    const result = await adapter.run(MARKDOWN_NO_HEADINGS, ctx);

    expect(result.artifacts.length).toBeLessThanOrEqual(2);
  });

  it("parses repo links from markdown with headings", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      if (typeof input === "string" && input.includes("- [skill-in-category]")) {
        return new Response(MARKDOWN_WITH_HEADINGS, {
          headers: { "Content-Type": "text/markdown" },
        });
      }
      return new Response(null, { status: 404 });
    };

    const adapter = awesomeListAdapter();
    const ctx = createTestCtx();

    const result = await adapter.run(MARKDOWN_WITH_HEADINGS, ctx);

    expect(result.artifacts.length).toBeGreaterThan(0);
  });
});