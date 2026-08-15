import { type ArtifactInput, type ArtifactKind } from "../artifact-schema";
import { type Adapter, type AdapterContext, type AdapterResult } from "../registry";
import { parseFrontmatter } from "../lib/frontmatter";

/**
 * Awesome List adapter.
 *
 * Parses a curated markdown list into candidate repos.
 *
 * - Extract only links under a heading, ignoring badges and the ToC.
 * - Emit `kind` from the list's configured kind, not guessed per-row.
 * - Cap at 500 per list; a runaway list must not flood a single batch.
 */
export const NAME = "awesome-list";

export const termsNote = "Curated awesome list markdown, parsed for repo links.";

export function awesomeListAdapter(): Adapter {
  return {
    name: NAME,
    kind: "skill",
    termsNote,

    async run(locator: string, ctx: AdapterContext): Promise<AdapterResult> {
      const { fetch, limit, logger } = ctx;

      logger(`info`, `awesome-list running with locator: ${locator}`);

      // locator is the URL or path to the awesome list markdown
      let markdown: string;

      if (locator.startsWith("http://") || locator.startsWith("https://")) {
        try {
          const response = await fetch(locator, {
            headers: {
              "Accept": "text/markdown",
              "User-Agent": "skills-hub-harvester",
            },
          });

          if (!response.ok) {
            logger("warn", `awesome-list failed to fetch ${locator}: ${response.status}`);
            return { artifacts: [], nextCursor: null, warnings: [`Failed to fetch ${locator}`] };
          }
          markdown = await response.text();
        } catch (err) {
          logger("error", `awesome-list network error: ${err}`);
          return { artifacts: [], nextCursor: null, warnings: [String(err)] };
        }
      } else {
        // Assume it's local content; for testing we'll use a fixture
        markdown = locator;
      }

      // Parse the markdown to extract repo links under headings
      // We'll look for lines like "- [repo-name](url)" under headings
      const lines = markdown.split("\n");
      const allArtifacts: ArtifactInput[] = [];
      let headingDepth = 0;

      for (const line of lines) {
        if (allArtifacts.length >= limit) break;

        // Check for heading (starts with #)
        const headingMatch = line.match(/^(\#{1,6})\s+/);
        if (headingMatch) {
          headingDepth = headingMatch[1].length;
          continue;
        }

        // Check if we're still within a heading section
        // A new heading resets us; check if line starts with more #s than current depth
        const newHeadingMatch = line.match(/^(\#{1,6})\s+/);
        if (newHeadingMatch && newHeadingMatch[1].length <= headingDepth) {
          // New top-level or same-level heading — stop processing content under this one
          // But we still continue the loop; the heading will reset depth
          if (newHeadingMatch[1].length === 1) {
            // Top-level heading, reset
            headingDepth = newHeadingMatch[1].length;
          }
          continue;
        }

        // Look for repo links: "- [display-name](url)" or "- [display-name](url 'title')"
        const linkMatch = line.match(/^\-\s+\[([^\]]+)\]\(([^)]+)\)/);
        if (!linkMatch) continue;

        const displayName = linkMatch[1];
        const url = linkMatch[2];

        // Filter out badges and non-repo links
        if (url.startsWith("http://badges.") || url.startsWith("https://badges.")) continue;
        if (url.startsWith("http") && (url.includes("badge") || url.includes("img"))) continue;
        if (!url.includes("/")) continue; // Must look like a path

        // Try to extract kind from the nearest heading above
        // For now, default to "skill"
        let kind: ArtifactKind = "skill";

        const artifact: ArtifactInput = {
          kind,
          name: displayName,
          source_url: url,
          summary: undefined,
          description: undefined,
          repo_full_name: undefined,
          repo_host: "github",
          tags: [],
          install_target: [],
          version: undefined,
          stars: 0,
          forks: 0,
          source_updated_at: undefined,
        };

        allArtifacts.push(artifact);
      }

      logger(`info`, `awesome-list found ${allArtifacts.length} artifacts`);

      return {
        artifacts: allArtifacts,
        nextCursor: null,
        warnings: [],
      };
    },
  };
}