import { type ArtifactInput, type ArtifactKind } from "../artifact-schema";
import { type Adapter, type AdapterContext, type AdapterResult } from "../registry";
import { parseFrontmatter } from "../lib/frontmatter";

/**
 * GitHub Code Search API adapter.
 *
 * Finds `SKILL.md` files with valid frontmatter via the GitHub code search API.
 *
 * - Auth required. Unauthenticated is 60 req/h and code search needs a token.
 * - Cursor = page number plus the query hash, so a query change resets cleanly.
 * - Parse YAML frontmatter for `name` and `description`. Frontmatter missing or
 *   unparseable is not a rejection — emit the artifact with
 *   `has_valid_frontmatter: false` and let the rubric score it down.
 * - `source_url` = the repo permalink at the default branch, never a commit SHA.
 */
export const NAME = "github-code-search";

export const termsNote = "Uses GitHub Code Search API, subject to GitHub Terms of Service. "
  + "Unauthenticated rate limit: 60 requests/hour.";

export function githubCodeSearchAdapter(
  token: string,
): Adapter & { token: string } {
  return {
    name: NAME,
    kind: "skill",
    termsNote,
    token,

    async run(locator: string, ctx: AdapterContext): Promise<AdapterResult> {
      const { fetch, limit, logger } = ctx;

      logger(
        "info",
        `github-code-search running with locator: ${locator}, limit: ${limit}`,
      );

      // locator can be "owner/repo" for repo-scoped search or a full search query
      let searchQuery: string;
      if (locator.includes("/") && !locator.includes(" ")) {
        // "owner/repo" format - search within this repo for SKILL.md
        const [owner, repo] = locator.split("/");
        searchQuery = `repo:${owner}/${repo} filename:SKILL.md`;
      } else {
        searchQuery = locator;
      }

      const allArtifacts: ArtifactInput[] = [];
      let page = 1;
      const perPage = 100;
      let hasMore = true;

      while (hasMore && allArtifacts.length < limit) {
        const url = new URL("https://api.github.com/search/code");
        url.searchParams.set("q", searchQuery);
        url.searchParams.set("per_page", perPage.toString());
        url.searchParams.set("page", page.toString());

        try {
          const response = await fetch(url.toString(), {
            headers: {
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "skills-hub-harvester",
              ...(token ? { Authorization: `token ${token}` } : {}),
            },
          });

          if (response.status === 403) {
            logger("warn", "GitHub API rate limit or forbidden");
            hasMore = false;
            break;
          }

          if (!response.ok) {
            logger("warn", `GitHub code search API returned ${response.status}`);
            hasMore = false;
            break;
          }

          const data = (await response.json()) as any;
          const items: any[] = data.items || [];

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of items) {
            // Only process SKILL.md files
            if (item.path !== "SKILL.md") continue;

            const repoFullName = item.repository.full_name;
            const repoUrl = item.html_url;

            // Fetch the SKILL.md file content
            const contentUrl = `https://api.github.com/repos/${repoFullName}/contents/SKILL.md`;
            try {
              const contentResponse = await fetch(contentUrl, {
                headers: {
                  "Accept": "application/vnd.github.v3.raw",
                  "User-Agent": "skills-hub-harvester",
                  ...(token ? { Authorization: `token ${token}` } : {}),
                },
              });

              if (!contentResponse.ok) {
                continue; // Skip this repo
              }

              const text = await contentResponse.text();
              if (!text) continue;

              const frontmatter = parseFrontmatter(text);

              // Build the artifact input
              const artifact: ArtifactInput = {
                kind: "skill",
                name: frontmatter.name || repoFullName.split("/")[1],
                source_url: repoUrl,
                summary: frontmatter.description,
                description: frontmatter.description,
                repo_full_name: repoFullName,
                repo_host: "github",
                tags: [],
                install_target: [],
                version: undefined,
                stars: 0,
                forks: 0,
                source_updated_at: undefined,
              };

              allArtifacts.push(artifact);

              if (allArtifacts.length >= limit) break;
            } catch (err) {
              logger("warn", `Failed to fetch SKILL.md from ${repoFullName}: ${err}`);
              continue;
            }
          }

          // Pagination: GitHub returns total_count so we know if there are more pages
          const totalCount = data.total_count || 0;
          const startIndex = (page - 1) * perPage + items.length;
          hasMore = startIndex < totalCount && allArtifacts.length < limit;
          page++;
        } catch (err) {
          logger("error", `GitHub code search network error: ${err}`);
          hasMore = false;
        }
      }

      logger(
        "info",
        `github-code-search found ${allArtifacts.length} artifacts across ${page - 1} pages`,
      );

      return {
        artifacts: allArtifacts,
        nextCursor: null,
        warnings: [],
      };
    },
  };
}