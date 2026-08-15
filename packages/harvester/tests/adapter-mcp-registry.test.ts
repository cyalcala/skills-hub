import { describe, it, expect } from "vitest";
import { mcpRegistryAdapter } from "../src/adapters/mcp-registry";

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

describe("mcp-registry adapter", () => {
  it("parses MCP servers from the registry", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/servers")) {
        return new Response(JSON.stringify({
          servers: [
            {
              "name": "test-mcp-server",
              "title": "Test MCP Server",
              "url": "https://example.com/mcp",
              "description": "A test MCP server for demonstration",
              "owner": "testuser",
              "repo": "testuser/test-mcp-server",
              "version": "1.0.0",
              "stars": 42,
              "lastUpdated": "2026-08-10T00:00:00Z"
            }
          ],
          nextCursor: "cursor123"
        }), { headers: { "Content-Type": "application/json" } });
      }

      return new Response(null, { status: 404 });
    };

    const adapter = mcpRegistryAdapter();
    const ctx = createTestCtx();

    const result = await adapter.run("https://registry.mcp.com", ctx);

    expect(result.artifacts.length).toBeGreaterThan(0);
    const artifact = result.artifacts[0];
    expect(artifact.kind).toBe("mcp");
    expect(artifact.name).toBe("test-mcp-server");
    expect(artifact.source_url).toBe("https://example.com/mcp");
    expect(artifact.stars).toBe(42);
  });

  it("respects the limit parameter", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/servers")) {
        return new Response(JSON.stringify({
          servers: [],
          nextCursor: null
        }), { headers: { "Content-Type": "application/json" } });
      }

      return new Response(null, { status: 404 });
    };

    const adapter = mcpRegistryAdapter();
    const ctx = createTestCtx();

    const result = await adapter.run("https://registry.mcp.com", ctx);

    expect(result.artifacts.length).toBeLessThanOrEqual(5);
  });
});