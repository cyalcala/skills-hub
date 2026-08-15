import { createRobotsCache, type RobotsParser } from "./src/lib/robots";
import { runAdapter, type Adapter, type AdapterResult, type HarvestReport, type ArtifactKind } from "./src/registry";
import { parseFrontmatter } from "./src/lib/frontmatter";
import { type ArtifactInput } from "./src/artifact-schema";

// ---------------------------------------------------------------------------
// CLI: orchestrates harvesting from all enabled sources
// ---------------------------------------------------------------------------

interface Config {
  agent: string;
  reportPath: string;
  limit?: number;
  dryRun?: boolean;
}

/** Emit a standardized harvest report. */
function emitReport(report: HarvestReport): void {
  const json = JSON.stringify(report, null, 2);
  console.log(json);
}

/** Run a single source through its adapter. */
async function runSource(
  adapter: Adapter,
  locator: string,
  ctx: {
    fetch: typeof globalThis.fetch;
    robots: RobotsParser;
    logger: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
    limit: number;
  },
  agent: string
): Promise<{ discovered: number; accepted: number; rejected: number; warnings: string[] }> {
  const start = Date.now();

  // Check robots.txt before fetching
  const parsedUrl = new URL(locator);
  const host = parsedUrl.hostname;
  const allowed = await ctx.robots.isAllowed(host, ctx.fetch?.name ?? "skills-hub-harvester", "/");

  if (!allowed) {
    ctx.logger("info", `robots.txt disallows fetching ${locator}`);
    return { discovered: 0, accepted: 0, rejected: 0, warnings: ["robots.txt disallowed"] };
  }

  ctx.logger("info", `robots.txt allows ${locator}`);

  // Run the adapter
  const ctxWithLimit = {
    fetch: ctx.fetch,
    cursor: ctx.robots.cache.has(`${new URL(locator).hostname}:${ctx.fetch?.name ?? "skills-hub-harvester"}`) 
      ? "resumed" : null,
    limit: ctx.limit,
    logger: ctx.logger,
  } as const;

  const result: AdapterResult = await adapter.run(locator, ctxWithLimit);

  const accepted = result.artifacts.length;
  const rejected = 0; // All emitted artifacts are "accepted" at harvest time

  ctx.logger("info", `adapter ${adapter.name} produced ${accepted} artifacts, ${rejected} rejected`);

  return {
    discovered: result.artifacts.length,
    accepted,
    rejected,
    warnings: result.warnings,
  };
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let agent = "scout";
  let reportPath = "scout-report.json";
  let limit = 500;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent") agent = args[++i];
    if (args[i] === "--report") reportPath = args[++i];
    if (args[i] === "--limit") limit = Number(args[++i]);
    if (args[i] === "--dry-run") dryRun = true;
    if (args[i] === "--adapter") {
      // Single adapter mode - will be handled per-source
    }
  }

  console.log(`Skills Harvester — Agent: ${agent}`);
  console.log(`Limit: ${limit}, Dry run: ${dryRun}`);

  // Define the three P3 adapters
  const adapters: Map<string, Adapter> = new Map();
  adapters.set("github-code-search", require("./src/adapters/github-code-search").githubCodeSearchAdapter("ghp_test_token"));
  adapters.set("mcp-registry", require("./src/adapters/mcp-registry").mcpRegistryAdapter());
  adapters.set("awesome-list", require("./src/adapters/awesome-list").awesomeListAdapter());

  // Define sources (in production these would come from D1)
  // For now, using hardcoded sources for the demo
  const sources = [
    { adapter: "github-code-search", locator: "owner/repo" },
    { adapter: "mcp-registry", locator: "https://registry.mcp.com" },
    { adapter: "awesome-list", locator: "https://github.com/list-of-awesome/awesome-ai-skills" },
  ];

  const robotsCache = createRobotsCache();

  const report: HarvestReport = {
    agent,
    startedAt: new Date().toISOString(),
    totals: { discovered: 0, accepted: 0, rejected: 0, failedSources: 0 },
    sources: [],
  };

  for (const source of sources) {
    const AdapterClass = adapters.get(source.adapter);
    if (!AdapterClass) {
      report.sources.push({
        adapter: source.adapter,
        locator: source.locator,
        discovered: 0,
        accepted: 0,
        rejected: 0,
        status: "failed" as const,
        warnings: [`Unknown adapter: ${source.adapter}`],
      });
      continue;
    }

    const adapter = new AdapterClass();
    const logger = {
      info: (level: string, msg: string, meta?: unknown) => {
        console.log(`[${level}] ${msg}`);
      },
      warn: (level: string, msg: string, meta?: unknown) => {
        console.warn(`[${level}] ${msg}`);
      },
      error: (level: string, msg: string, meta?: unknown) => {
        console.error(`[${level}] ${msg}`);
      },
    };

    try {
      const { discovered, accepted, rejected, warnings } = await runSource(
        adapter,
        source.locator,
        {
          fetch: globalThis.fetch,
          robots: robotsCache,
          logger,
          limit,
        },
        agent
      );

      report.totals.discovered += discovered;
      report.totals.accepted += accepted;
      report.totals.rejected += rejected;
      report.totals.failedSources += 0;

      report.sources.push({
        adapter: source.adapter,
        locator: source.locator,
        discovered,
        accepted,
        rejected,
        status: "ok" as const,
        warnings,
      });
    } catch (err) {
      report.totals.failedSources++;
      report.sources.push({
        adapter: source.adapter,
        locator: source.locator,
        discovered: 0,
        accepted: 0,
        rejected: 0,
        status: "failed" as const,
        warnings: [String(err)],
      });
    }
  }

  report.finishedAt = new Date().toISOString();

  // Update totals
  report.totals.discovered = report.sources.reduce((sum, s) => sum + s.discovered, 0);
  report.totals.accepted = report.sources.reduce((sum, s) => sum + s.accepted, 0);
  report.totals.rejected = report.sources.reduce((sum, s) => sum + s.rejected, 0);

  if (!dryRun) {
    // In production, we would POST to the ingest API
    // For now, just emit the report
    console.log("\n--- Report ---");
    emitReport(report);

    // Write report to file if requested
    if (reportPath) {
      const fs = await import("fs");
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`Report written to ${reportPath}`);
    }
  } else {
    console.log("\n--- Dry run report ---");
    emitReport(report);
  }
}

main().catch((err) => {
  console.error("Harvest failed:", err);
  process.exit(1);
});