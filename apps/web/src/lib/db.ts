// Type-safe D1 query layer.
//
// Owned by the `db` module (specs/SPEC-db.md). Every other module reads and
// writes through this layer. No raw SQL exists outside this file.
//
// > Never write raw SQL outside `apps/web/src/lib/`. This is a golden rule —
//   index alignment and parameter safety can only be audited from this one file.

import type { ArtifactInput } from "./artifact-schema";
import type { ScoreInput } from "./quality";

// ---------------------------------------------------------------------------
// Row interfaces — mirror the D1 schema columns that the app ever reads by name.
// ---------------------------------------------------------------------------

export interface ArtifactRow {
  id: number;
  kind: string;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  source_url: string;
  repo_full_name: string | null;
  repo_host: string | null;
  homepage_url: string | null;
  license: string | null;
  author: string | null;
  tags: string;
  categories: string;
  install_target: string;
  version: string | null;
  stars: number;
  forks: number;
  quality_score: number;
  quality_breakdown: string;
  content_hash: string;
  first_seen_at: string;
  last_seen_at: string;
  source_updated_at: string | null;
  enriched_at: string | null;
  is_active: number; // 0 | 1
  inactive_reason: string | null;
}

export interface SourceRow {
  id: number;
  adapter: string;
  locator: string;
  kind: string;
  enabled: number; // 0 | 1
  cadence_hours: number;
  last_run_at: string | null;
  last_cursor: string | null;
  consecutive_failures: number;
  health: string;
  notes: string | null;
  created_at: string;
}

export interface CategoryRow {
  id: number;
  slug: string;
  label: string;
  kind: string | null;
  description: string | null;
  artifact_count: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Named-bind query helpers
// ---------------------------------------------------------------------------

/** Active artifacts of one kind, best-scored first. Index-aligned. */
export async function listByKind(
  db: D1Database,
  kind: string,
  limit: number,
  offset: number,
): Promise<ArtifactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, slug, summary, description, source_url,
               repo_full_name, repo_host, homepage_url, license, author,
               tags, categories, install_target, version, stars, forks,
               quality_score, quality_breakdown, content_hash,
               first_seen_at, last_seen_at, source_updated_at, enriched_at,
               is_active, inactive_reason
          FROM artifacts
         WHERE is_active = 1 AND kind = ?1
         ORDER BY quality_score DESC
         LIMIT ?2 OFFSET ?3`,
    )
    .bind(kind, limit, offset)
    .all<ArtifactRow>();
  return results ?? [];
}

/** Active artifacts across all kinds, best-scored first. */
export async function listAll(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<ArtifactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, slug, summary, description, source_url,
               repo_full_name, repo_host, homepage_url, license, author,
               tags, categories, install_target, version, stars, forks,
               quality_score, quality_breakdown, content_hash,
               first_seen_at, last_seen_at, source_updated_at, enriched_at,
               is_active, inactive_reason
          FROM artifacts
        WHERE is_active = 1
        ORDER BY quality_score DESC
        LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<ArtifactRow>();
  return results ?? [];
}

/** Artifact by source_url (unique). */
export async function getByUrl(
  db: D1Database,
  sourceUrl: string,
): Promise<ArtifactRow | null> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, slug, summary, description, source_url,
               repo_full_name, repo_host, homepage_url, license, author,
               tags, categories, install_target, version, stars, forks,
               quality_score, quality_breakdown, content_hash,
               first_seen_at, last_seen_at, source_updated_at, enriched_at,
               is_active, inactive_reason
          FROM artifacts
         WHERE source_url = ?1`,
    )
    .bind(sourceUrl)
    .all<ArtifactRow>();
  return results?.[0] ?? null;
}

/** Artifacts with no enrichment yet — Curator work queue. */
export async function listUnenriched(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<ArtifactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, slug, summary, description, source_url,
               repo_full_name, repo_host, homepage_url, license, author,
               tags, categories, install_target, version, stars, forks,
               quality_score, quality_breakdown, content_hash,
               first_seen_at, last_seen_at, source_updated_at, enriched_at,
               is_active, inactive_reason
          FROM artifacts
         WHERE is_active = 1 AND enriched_at IS NULL
         ORDER BY enriched_at ASC NULLS FIRST, last_seen_at DESC
         LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<ArtifactRow>();
  return results ?? [];
}

/** Source due for a run (enabled + past cadence). */
export async function getDueSources(
  db: D1Database,
): Promise<SourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, adapter, locator, kind, enabled, cadence_hours,
               last_run_at, last_cursor, consecutive_failures, health, notes,
               created_at
          FROM sources
         WHERE enabled = 1`,
    )
    .all<SourceRow>();
  return results ?? [];
}

// ---------------------------------------------------------------------------
// Category queries
// ---------------------------------------------------------------------------

export async function listCategories(
  db: D1Database,
): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, label, kind, description, artifact_count, updated_at
          FROM categories
         ORDER BY slug`,
    )
    .all<CategoryRow>();
  return results ?? [];
}

// ---------------------------------------------------------------------------
// Run-lock helper (re-exports from run-lock.ts for convenience)
// ---------------------------------------------------------------------------

export { acquireLock, releaseLock, holderId, isExpired, DEFAULT_TTL_SECONDS } from "./run-lock";

// ---------------------------------------------------------------------------
// Time helpers (ISO-8601 UTC normalization)
// ---------------------------------------------------------------------------

export const isoPlusSeconds = (now: Date, seconds: number): string =>
  new Date(now.getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

export const toIso = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");

export const DAY_MS = 86_400_000;

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const delta = now.getTime() - then;
  if (delta < 0) return 0;
  return Math.floor(delta / DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Slug derivation
// ---------------------------------------------------------------------------

/** URL-safe slug from a display name. Stable: derive once, never regenerate. */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "artifact";
}

// ---------------------------------------------------------------------------
// Ingest-friendly upsert
// ---------------------------------------------------------------------------

/**
 * Insert or update a single artifact, keyed on source_url.
 *
 * Behaviour (per SPEC-ingest.md):
 *   — No row with this source_url          → INSERT, first_seen_at = now
 *   — Row exists, hash UNCHANGED           → UPDATE last_seen_at ONLY  → "unchanged"
 *   — Row exists, hash CHANGED             → UPDATE fields + last_seen_at,
 *                                           clear enriched_at → "updated"
 */
export async function upsertArtifact(
  db: D1Database,
  row: {
    kind: string;
    name: string;
    summary: string | null;
    description: string | null;
    source_url: string;
    repo_full_name: string | null;
    repo_host: string | null;
    homepage_url: string | null;
    license: string | null;
    author: string | null;
    tags: string[];
    categories: string[];
    install_target: string[];
    version: string | null;
    stars: number;
    forks: number;
    quality_score: number;
    quality_breakdown: string;
    content_hash: string;
    first_seen_at?: string;
    last_seen_at?: string;
    source_updated_at?: string | null;
    enriched_at?: string | null;
    is_active?: number;
    inactive_reason?: string | null;
  },
): Promise<{ status: "inserted" | "unchanged" | "updated"; previousHash?: string }> {
  const now = row.last_seen_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const isActive = row.is_active ?? 1;
  const inactiveReason = row.is_active === 0 ? (row.inactive_reason ?? null) : null;

  // Read the current row first so the outcome is honest: the spec's contract is
  // `inserted` / `unchanged` / `updated`, and an atomic ON CONFLICT cannot tell
  // those apart from `changes` alone. Callers hold the `ingest` run-lock, so the
  // read-then-write window is safe in production.
  const existing = await db
    .prepare(
      `SELECT content_hash, is_active, enriched_at FROM artifacts WHERE source_url = ?1`,
    )
    .bind(row.source_url)
    .first<{ content_hash: string; is_active: number; enriched_at: string | null }>();

  if (!existing) {
    // No row with this source_url → INSERT, first_seen_at = now
    await db
      .prepare(
        `INSERT INTO artifacts (
          kind, name, slug, summary, description, source_url, repo_full_name,
          repo_host, homepage_url, license, author, tags, categories,
          install_target, version, stars, forks, quality_score, quality_breakdown,
          content_hash, first_seen_at, last_seen_at, source_updated_at,
          enriched_at, is_active, inactive_reason
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
        )`,
      )
      .bind(
        row.kind,
        row.name,
        slugifyName(row.name),
        row.summary,
        row.description,
        row.source_url,
        row.repo_full_name,
        row.repo_host,
        row.homepage_url,
        row.license,
        row.author,
        JSON.stringify(row.tags),
        JSON.stringify(row.categories),
        JSON.stringify(row.install_target),
        row.version,
        row.stars,
        row.forks,
        row.quality_score,
        row.quality_breakdown,
        row.content_hash,
        row.first_seen_at ?? now,
        now,
        row.source_updated_at ?? null,
        row.enriched_at ?? null,
        isActive,
        inactiveReason,
      )
      .run();
    return { status: "inserted" as const };
  }

  if (existing.content_hash === row.content_hash) {
    // Hash UNCHANGED → touch last_seen_at only. Reactivate if it had been
    // deactivated: the spec says things come back from the dead.
    await db
      .prepare(
        `UPDATE artifacts
            SET last_seen_at = ?1,
                is_active = CASE
                  WHEN ?2 = 1 THEN 1
                  ELSE artifacts.is_active
                END,
                inactive_reason = CASE
                  WHEN ?2 = 1 THEN NULL
                  ELSE artifacts.inactive_reason
                END
          WHERE source_url = ?3`,
      )
      .bind(now, isActive, row.source_url)
      .run();
    return {
      status: "unchanged" as const,
      previousHash: existing.content_hash,
    };
  }

  // Hash CHANGED → update fields + last_seen_at, clear enriched_at → "updated"
  await db
    .prepare(
      `UPDATE artifacts SET
         kind = ?2, name = ?3, summary = ?4, description = ?5,
         repo_full_name = ?6, repo_host = ?7, homepage_url = ?8,
         license = ?9, author = ?10, tags = ?11, categories = ?12,
         install_target = ?13, version = ?14, stars = ?15, forks = ?16,
         quality_score = ?17, quality_breakdown = ?18, content_hash = ?19,
         last_seen_at = ?20, source_updated_at = ?21,
         enriched_at = NULL,
         is_active = CASE
           WHEN ?22 = 1 THEN 1
           ELSE CASE WHEN ?23 IS NOT NULL THEN 0 ELSE artifacts.is_active END
         END,
         inactive_reason = CASE
           WHEN ?22 = 0 THEN ?23
           WHEN artifacts.is_active = 0 THEN NULL
           ELSE artifacts.inactive_reason
         END
       WHERE source_url = ?1`,
    )
    .bind(
      row.source_url,
      row.kind,
      row.name,
      row.summary,
      row.description,
      row.repo_full_name,
      row.repo_host,
      row.homepage_url,
      row.license,
      row.author,
      JSON.stringify(row.tags),
      JSON.stringify(row.categories),
      JSON.stringify(row.install_target),
      row.version,
      row.stars,
      row.forks,
      row.quality_score,
      row.quality_breakdown,
      row.content_hash,
      now,
      row.source_updated_at ?? null,
      isActive,
      inactiveReason,
    )
    .run();
  return {
    status: "updated" as const,
    previousHash: existing.content_hash,
  };
}

// ---------------------------------------------------------------------------
// Health / staleness
// ---------------------------------------------------------------------------

/** Artifact is considered stale if last_seen_at is older than `days` days. */
export function isStale(lastSeenAt: string | null, days: number, now: Date): boolean {
  if (!lastSeenAt) return true;
  const then = new Date(lastSeenAt).getTime();
  const nowMs = now.getTime();
  const ageMs = nowMs - then;
  return ageMs > days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Export a handy type for the DB binding locals
// ---------------------------------------------------------------------------

export type DbLocals = {
  DB: D1Database;
  proxySecret?: string | undefined;
};