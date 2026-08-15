import { Hono } from "hono";
import { type Context } from "hono";
import type { APIContext } from "astro";
import type { D1Database } from "@cloudflare/workers-types";
import { listCategories } from "../../../lib/db";

const app = new Hono().basePath("/api/cron/taxonomy");

/** POST /api/cron/taxonomy - Full taxonomy recount */
app.post("/", async (c: Context) => {
  const DB = c.env.DB as D1Database;

  // Recount artifact_count from scratch for each category
  // This never increments ad hoc — the Cartographer recalculates weekly

  // Get all categories with current counts
  const categories = await listCategories(DB);

  for (const category of categories) {
    const slug = category.slug;

    const row = await DB.prepare(`
      SELECT COUNT(*) as count
      FROM artifacts
      WHERE is_active = 1
      AND categories LIKE ?1
    `).bind(`%${slug}%`).first<{ count: number }>();

    const count = row?.count ?? 0;

    // Update the category with the correct count
    await DB.prepare(
      `UPDATE categories SET artifact_count = ?1, updated_at = ?2 WHERE slug = ?3`,
    )
      .bind(count, new Date().toISOString(), slug)
      .run();
  }

  return c.json({ recounted: categories.length });
});

export const POST = (context: APIContext) => app.fetch(context.request, context.locals.runtime.env);