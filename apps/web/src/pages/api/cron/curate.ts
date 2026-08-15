import { Hono } from "hono";
import { type Context } from "hono";
import { scoreArtifact, type ScoreInput, type ScoreResult } from "../../src/lib/quality";
import { db } from "../../src/lib/db";
import { listUnenriched } from "../../src/lib/db";
import { mapToCategories } from "../../src/lib/taxonomy";

const app = new Hono();

type CurateBody = {
  limit?: number;
  force?: boolean;
};

/** POST /api/cron/curate */
app.post("/", async (c: Context) => {
  const body = (await c.req.json()) as CurateBody;
  const limit = body.limit ?? 100;
  const force = body.force ?? false;
  const now = new Date();

  // Select artifacts that need enrichment
  // - enriched_at IS NULL (never enriched), OR
  // - enriched_at is older than last_seen_at (content changed)
  // Ordered by enriched_at ASC NULLS FIRST (priority to never-enriched)
  const artifacts = await listUnenriched(db, limit);

  let scored = 0;
  let skipped = 0;

  for (const artifact of artifacts) {
    // Build the score input from the artifact data
    const tags = typeof artifact.tags === "string" ? JSON.parse(artifact.tags) : (artifact.tags || []);
    const install_target = typeof artifact.install_target === "string"
      ? JSON.parse(artifact.install_target)
      : (artifact.install_target || []);

    const input: ScoreInput = {
      kind: artifact.kind,
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
    const result: ScoreResult = scoreArtifact(input, now);

    // Update the artifact with the score and breakdown
    // Also compute categories using taxonomy
    const categories = mapToCategories(
      artifact.kind,
      tags,
      install_target,
      artifact.name || "",
    );

    // Build categories JSON for the artifact
    const categoriesJson = JSON.stringify(categories.map(c => ({ slug: c, label: c })));

    await db.prepare(
      `UPDATE artifacts SET quality_score = ?1, quality_breakdown = ?2, enriched_at = ?3, categories = ?4
       WHERE id = ?5`,
    )
      .bind(result.score, JSON.stringify(result.breakdown), now.toISOString(), categoriesJson, artifact.id)
      .run();

    scored++;
  }

  return c.json({ scored, skipped: artifacts.length - scored });
});

export default app;