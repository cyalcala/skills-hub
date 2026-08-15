import { Hono } from "hono";
import { type Context } from "hono";
import type { APIContext } from "astro";
import { scoreArtifact } from "../../../lib/quality";
import { listUnenriched } from "../../../lib/db";
import { mapToCategories } from "../../../lib/taxonomy";
import { enrichArtifact } from "../../../lib/enrich-fetch";

const app = new Hono().basePath("/api/cron/curate");

type CurateBody = {
  limit?: number;
};

/** POST /api/cron/curate - Curator enrichment pipeline */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as CurateBody;
  const limit = body.limit ?? 100;
  const now = new Date();
  const DB = c.env.DB;

  // Select artifacts that need enrichment
  const artifacts = await listUnenriched(DB, limit, 0);

  let enriched = 0;
  let skipped = 0;

  for (const artifact of artifacts) {
    // Build the score input from the artifact data
    const tags = typeof artifact.tags === "string"
      ? JSON.parse(artifact.tags)
      : (artifact.tags || []);

    const install_target = typeof artifact.install_target === "string"
      ? JSON.parse(artifact.install_target)
      : (artifact.install_target || []);

    const input: Parameters<typeof scoreArtifact>[0] = {
      kind: artifact.kind as Parameters<typeof scoreArtifact>[0]["kind"],
      name: artifact.name,
      summary: artifact.summary,
      description: artifact.description,
      license: artifact.license,
      tags,
      install_target,
      stars: artifact.stars,
      source_updated_at: artifact.source_updated_at,
      has_valid_frontmatter: artifact.name !== null && artifact.description !== null,
      has_readme: false,
      has_examples: false,
    };

    // Score the artifact
    const result: ReturnType<typeof scoreArtifact> = scoreArtifact(input, now);

    // Detect README and examples using the pure enrichment function
    const enrichment = enrichArtifact(input, now);

    // Build categories using taxonomy
    const categories = mapToCategories(
      artifact.kind,
      tags,
      install_target,
      artifact.name || "",
    );

    // Build categories JSON for the artifact
    const categoriesJson = JSON.stringify(categories.map((c: string) => ({ slug: c, label: c })));

    // Compute a combined breakdown: quality score + documentation flags
    const breakdown = {
      metadata: result.breakdown.metadata,
      documentation: result.breakdown.documentation,
      freshness: result.breakdown.freshness,
      licensing: result.breakdown.licensing,
      popularity: result.breakdown.popularity,
      discoverability: 0,
    };

    await DB.prepare(
      `UPDATE artifacts SET
        quality_score = ?1,
        quality_breakdown = ?2,
        enriched_at = ?3,
        categories = ?4
      WHERE id = ?5`,
    )
      .bind(result.score, JSON.stringify(breakdown), now.toISOString(), categoriesJson, artifact.id)
      .run();

    enriched++;
  }

  return c.json({ enriched, skipped: artifacts.length - enriched });
});

export const POST = (context: APIContext) => app.fetch(context.request, context.locals.runtime.env);