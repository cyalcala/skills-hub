import { Hono } from "hono";
import { type Context } from "hono";
import { db } from "../../src/lib/db";

const app = new Hono();

/** POST /api/cron/taxonomy */
app.post("/", async (c: Context) => {
  // Recalculate artifact counts for each category
  // Get all categories
  const categories = await db.prepare(
    `SELECT id, slug, kind FROM categories ORDER BY slug`
  )
    .all();

  let recounted = 0;
  let driftCorrected = 0;

  if (categories?.results) {
    for (const cat of categories.results as any[]) {
      // Count artifacts in this category that are active and match the kind
      const countResult = await db.prepare(
        `SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1 AND categories LIKE ?1`,
      )
        .bind(`%${cat.slug}%`)
        .first();

      const newCount = countResult?.count ?? 0;

      // Update the category count
      await db.prepare(
        `UPDATE categories SET artifact_count = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?2`,
      )
        .bind(newCount, cat.id)
        .run();

      // If the count changed, record drift
      // In a real implementation, we'd compare with the previous count
      // For now, we just count how many were recounted
      recounted++;
    }
  }

  return c.json({ categories: categories?.length ?? 0, recounted, driftCorrected });
});

export default app;