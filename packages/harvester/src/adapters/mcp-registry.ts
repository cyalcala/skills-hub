import { type ArtifactInput, type ArtifactKind } from "../artifact-schema";
import { type Adapter, type AdapterContext, type AdapterResult } from "../registry";

/**
 * MCP Registry adapter.
 *
 * The official MCP server registry. Structured JSON, generous shape, low risk.
 * Cursor = the registry's own pagination token.
 */
export const NAME = "mcp-registry";

export const termsNote = "MCP server registry, public JSON endpoint.";

export function mcpRegistryAdapter(): Adapter {
  return {
    name: NAME,
    kind: "mcp",
    termsNote,

    async run(locator: string, ctx: AdapterContext): Promise<AdapterResult> {
      const { fetch, limit, logger } = ctx;

      logger(`info`, `mcp-registry running with locator: ${locator}`);

      // locator is the MCP registry endpoint URL
      const baseUrl = typeof locator === "string" && locator.startsWith("http")
        ? locator
        : "https://registry.mcp.com";

      let cursor = ctx.cursor;
      let page = 1;
      const allArtifacts: ArtifactInput[] = [];

      while (allArtifacts.length < limit) {
        const url = new URL(`${baseUrl}/api/servers`);
        url.searchParams.set("limit", "50");
        if (cursor) {
          url.searchParams.set("cursor", cursor);
        } else if (page > 1) {
          url.searchParams.set("page", page.toString());
        }

        try {
          const response = await fetch(url.toString(), {
            headers: {
              "Accept": "application/json",
              "User-Agent": "skills-hub-harvester",
            },
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "unknown error");
            logger("warn", `mcp-registry API returned ${response.status}: ${text.substring(0, 200)}`);
            break;
          }

          const data = await response.json();

          // Handle pagination token
          const items: any[] = data.servers || data.items || [];

          if (items.length === 0) {
            break;
          }

          for (const item of items) {
            if (allArtifacts.length >= limit) break;

            // Normalize the MCP server entry into an ArtifactInput
            const artifact: ArtifactInput = {
              kind: "mcp",
              name: item.name || item.title || "Unnamed MCP server",
              source_url: item.url || item.href || "",
              summary: item.description || undefined,
              description: item.description || undefined,
              repo_full_name: item.owner?.repo || undefined,
              repo_host: "other",
              tags: item.tags ? item.tags.split(","").map((t: string) => t.trim()).filter((t: string) => t.length > 0) : [],
              install_target: ["generic"],
              version: item.version || undefined,
              stars: item.stars || 0,
              forks: 0,
              source_updated_at: item.lastUpdated || undefined,
            };

            allArtifacts.push(artifact);
          }

          // Pagination
          cursor = data.nextCursor || data.next_page_cursor;
          if (!cursor) {
            page++;
          }

          if (!cursor && page > 10) {
            // Safety valve to prevent infinite loop
            break;
          }
        } catch (err) {
          logger("error", `mcp-registry network error: ${err}`);
          break;
        }
      }

      logger(`info`, `mcp-registry found ${allArtifacts.length} artifacts`);

      return {
        artifacts: allArtifacts,
        nextCursor: cursor,
        warnings: [],
      };
    },
  };
}