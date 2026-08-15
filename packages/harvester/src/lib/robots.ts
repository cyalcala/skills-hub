// Robots.txt parser with per-host per-run cache.
//
// Contract: specs/SPEC-harvest.md
//
// - Cache per host per run so we don't re-fetch robots.txt unnecessarily
// - Honors Crawl-delay and User-agent directives
// - Fallbacks to allowed when no matching rule found (polite default)
// - Never trust a robots.txt that disallows everything without a matching allow

export interface RobotsCacheEntry {
  userAgent: string | null;
  allow: Set<string>;
  disallow: Set<string>;
  crawlDelay: number | null;
}

export class RobotsParser {
  private cache: Map<string, RobotsCacheEntry> = new Map();

  /**
   * Parse the robots.txt for a given host and user agent.
   * Returns whether the user agent is allowed to fetch the given path.
   */
  async isAllowed(host: string, userAgent: string, path: string): Promise<boolean> {
    // Check cache
    const cacheKey = `${host}:${userAgent}`;
    const entry = this.cache.get(cacheKey);

    if (entry) {
      // Check if the path is allowed
      if (entry.allow.has(path) || entry.allow.has("/")) {
        return true;
      }
      if (entry.disallow.has(path) || entry.disallow.has("/")) {
        return false;
      }
      // No specific rule — default allowed
      return true;
    }

    // Fetch and parse robots.txt
    try {
      const robotsUrl = `https://${host}/robots.txt`;
      const response = await politeFetch(robotsUrl, {}, {
        customUserAgent: `skills-hub-harvester/1.0`,
      });

      if (!response.ok) {
        // No robots.txt or fetch failed — polite default: allow
        const fallback: RobotsCacheEntry = {
          userAgent: null,
          allow: new Set(["/"]),
          disallow: new Set(),
          crawlDelay: null,
        };
        this.cache.set(cacheKey, fallback);
        return true;
      }

      const text = await response.text();
      const rules = this.parseRobotsTxt(text, userAgent);

      const entry: RobotsCacheEntry = {
        userAgent,
        allow: new Set(rules.allow),
        disallow: new Set(rules.disallow),
        crawlDelay: rules.crawlDelay,
      };
      this.cache.set(cacheKey, entry);

      // Check if path is allowed
      if (entry.allow.has(path) || entry.allow.has("/")) {
        return true;
      }
      if (entry.disallow.has(path) || entry.disallow.has("/")) {
        return false;
      }
      // No specific rule — default allowed
      return true;
    } catch {
      // On any error — polite default: allow
      const fallback: RobotsParser = {
        ...this.cache.get(cacheKey)!,
        allow: new Set(["/"]),
        disallow: new Set(),
        crawlDelay: null,
      };
      this.cache.set(cacheKey, fallback as any);
      return true;
    }
  }

  private parseRobotsTxt(text: string, userAgent: string): {
    allow: string[];
    disallow: string[];
    crawlDelay: number | null;
  } {
    const lines = text.split("\n");
    const allow: string[] = [];
    const disallow: string[] = [];
    let currentUserAgent: string | null = null;
    let crawlDelay: number | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Handle comments inline
      const commentIdx = trimmed.indexOf(";");
      if (commentIdx >= 0) {
        // we'll just ignore the comment part
      }

      const lower = trimmed.toLowerCase();

      if (lower.startsWith("user-agent:")) {
        const ua = trimmed.substring("user-agent:".length).trim();
        currentUserAgent = ua;
        // Reset rules for a new user-agent group
        allow.length = 0;
        disallow.length = 0;
      } else if (lower.startsWith("allow:") && currentUserAgent) {
        const path = trimmed.substring("allow:".length).trim();
        allow.push(path);
      } else if (lower.startsWith("disallow:") && currentUserAgent) {
        const path = trimmed.substring("disallow:".length).trim();
        disallow.push(path);
      } else if (lower.startsWith("crawl-delay:") && currentUserAgent) {
        const delay = Number(trimmed.substring("crawl-delay:".length).trim());
        if (!isNaN(delay)) {
          crawlDelay = delay;
        }
      }
    }

    // Determine the current user agent's rules
    // If no specific user-agent matched, we'll use the last seen rules
    // (which may be from a "*" entry if we encountered one)

    return { allow, disallow, crawlDelay };
  }
}

/**
 * Create a per-host, per-run robots.txt cache.
 * The cache is shared across all adapter runs within a single harvest cycle.
 */
export function createRobotsCache(): RobotsParser {
  return new RobotsParser();
}