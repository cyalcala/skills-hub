import { Hono } from "hono";
import { type Context } from "hono";
import type { APIContext } from "astro";
import { isAuthorized } from "../../lib/auth";
import { validateIngestBody, type ArtifactKind } from "../../lib/artifact-schema";
import { chunkByVariableBudget, MAX_SQL_VARIABLES } from "../../lib/ingest-batch";
import { upsertArtifact } from "../../lib/upsert";
import { acquireLock, releaseLock, holderId } from "../../lib/run-lock";
import { computeContentHash } from "../../lib/content-hash";

const app = new Hono().basePath("/api/ingest");

// Maximum artifacts per single API call per SPEC-ingest.md
const MAX_ARTIFACTS = 500;

// Lock name for the ingest operation
const LOCK_NAME = "ingest";

// Accept either Bearer token or x-cron-secret header
app.post(
  "/",
  async (c: Context) => {
    const rawRequest = c.req.raw;

    // --- Authentication ---
    const proxySecret = c.env.PROXY_SECRET || c.env.CRON_SECRET;
    if (!isAuthorized(rawRequest, proxySecret)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // --- Parse and validate body ---
    const body = (await c.req.json()) as unknown;
    const validation = validateIngestBody(body);
    if (!validation.ok) {
      return c.json({ ok: false, issues: validation.issues }, 400);
    }

    const validated = validation.value as {
      agent: string;
      source_id?: number | null;
      artifacts: {
        kind: string;
        name: string;
        summary?: string | null;
        description?: string | null;
        source_url: string;
        repo_full_name?: string | null;
        repo_host?: "github" | "gitlab" | "other" | null;
        homepage_url?: string | null;
        license?: string | null;
        author?: string | null;
        tags?: string[];
        install_target?: string[];
        version?: string | null;
        stars?: number;
        forks?: number;
        source_updated_at?: string | null;
      }[];
    };

    // --- Lock acquisition ---
    const now = new Date();
    const lockResult = await acquireLock(
      c.env.DB,
      LOCK_NAME,
      validated.agent,
      now,
    );

    if (!lockResult.acquired) {
      return c.json(
        {
          ok: false,
          status: "failed",
          heldBy: lockResult.heldBy,
          expiresAt: lockResult.expiresAt,
        },
        409,
      );
    }

    try {
      const artifacts: typeof validated.artifacts = validated.artifacts;

      // Sanity check: batch cap
      if (artifacts.length > MAX_ARTIFACTS) {
        return c.json(
          {
            ok: false,
            error: `batch of ${artifacts.length} exceeds max ${MAX_ARTIFACTS}; chunk upstream`,
          },
          400,
        );
      }

      // Chunk by variable budget (rows × columns), not by row count
      // ArtifactInput has ~27 bind parameters per row
      const columnsPerRow = 27;
      const chunks = chunkByVariableBudget(artifacts, columnsPerRow, MAX_SQL_VARIABLES);

      let totalAttempted = 0;
      let totalInserted = 0;
      let totalUpdated = 0;
      let totalUnchanged = 0;
      let totalRejected = 0;
      const allErrors: string[] = [];

      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
          const artifact = chunk[i]!;
          try {
            const contentHash = await computeContentHash({
              kind: artifact.kind as ArtifactKind,
              name: artifact.name,
              summary: artifact.summary ?? "",
              source_url: artifact.source_url,
              license: artifact.license ?? "",
              tags: artifact.tags ?? [],
            });

            const result = await upsertArtifact(c.env.DB, {
              kind: artifact.kind,
              name: artifact.name,
              summary: artifact.summary ?? null,
              description: artifact.description ?? null,
              source_url: artifact.source_url,
              repo_full_name: artifact.repo_full_name ?? null,
              repo_host: artifact.repo_host ?? null,
              homepage_url: artifact.homepage_url ?? null,
              license: artifact.license ?? null,
              author: artifact.author ?? null,
              tags: artifact.tags ?? [],
              categories: [], // categories populated later by Curator
              install_target: artifact.install_target ?? [],
              version: artifact.version ?? null,
              stars: artifact.stars ?? 0,
              forks: artifact.forks ?? 0,
              quality_score: 0,
              quality_breakdown: "{}",
              content_hash: contentHash,
              source_updated_at: artifact.source_updated_at ?? null,
              is_active: 1,
            });

            totalAttempted++;

            switch (result.status) {
              case "inserted":
                totalInserted++;
                break;
              case "updated":
                totalUpdated++;
                break;
              case "unchanged":
                totalUnchanged++;
                break;
            }
          } catch (e) {
            totalAttempted++;
            totalRejected++;
            allErrors.push(`artifact at index ${i} threw: ${String(e)}`);
          }
        }
      }

      // --- Write source_runs evidence row ---
      const startedAt = now.toISOString();
      const finishedAt = new Date().toISOString();
      const status = totalRejected > 0 ? "partial" : "ok";
      const accepted = totalAttempted - totalRejected;

      const run = await c.env.DB.prepare(
        `INSERT INTO source_runs (source_id, agent, started_at, finished_at, status, discovered, accepted, rejected, errors)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
        .bind(
          validated.source_id ?? null,
          validated.agent,
          startedAt,
          finishedAt,
          status,
          artifacts.length,
          accepted,
          totalRejected,
          JSON.stringify(allErrors),
        )
        .run();

      const response = {
        ok: true,
        runId: run.meta.last_row_id ?? Date.now() % 1000000,
        attempted: totalAttempted,
        accepted,
        rejected: totalRejected,
        inserted: totalInserted,
        updated: totalUpdated,
        unchanged: totalUnchanged,
        failedChunks: 0,
        errors: allErrors,
        status,
      };

      return c.json(response, 200);
    } catch (e) {
      // D1 unavailable or other runtime error
      return c.json({ error: "D1 unavailable" }, 503);
    } finally {
      // Always release the lock - holder is the agent that acquired it
      try {
        await releaseLock(
          c.env.DB,
          LOCK_NAME,
          validated.agent,
        );
      } catch {}
    }
  },
);

export const POST = (context: APIContext) => app.fetch(context.request, context.locals.runtime.env);

export { app };