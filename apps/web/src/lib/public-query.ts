// Type-safe paginated read queries used by the web module.
// Contract: specs/SPEC-web.md
//
// Critical: pagination must be server-side from day one. The model repo's
// homepage hit 1.75 MB before pagination was noticed. Every list route has
// an explicit empty state and an error boundary.

import { type ArtifactRow } from "./artifact-schema";

/** Default page size for list routes. */
export const DEFAULT_PAGE_SIZE = 24;
/** Hard maximum page size - clamps ?limit=100000 to 100. */
export const MAX_PAGE_SIZE = 100;

/**
 * Paginated artifact query.
 * 
 * Parameters:
 *   kind: Filter by artifact kind (optional, omit for all kinds)
 *   page: Page number (1-indexed)
 *   limit: Override default page size (clamped to MAX_PAGE_SIZE)
 *   offset: Used internally for cursor-based pagination
 * 
 * Returns results and metadata for rendering pagination controls.
 */
export interface PaginatedArtifacts {
  artifacts: ArtifactRow[];
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** URL for the next page, or null if no more results */
  nextUrl: string | null;
  /** URL for the previous page, or null if on first page */
  prevUrl: string | null;
}

/**
 * Build a paginated query for active artifacts.
 * 
 * @param db D1 database binding
 * @param kind Optional kind filter
 * @param page Page number (1-indexed)
 * @param limit Override page size (clamped to MAX_PAGE_SIZE)
 * @returns PaginatedArtifacts with results and pagination metadata
 */
export async function listPaginated(
  db: any, // D1Database
  kind?: string,
  page: number = 1,
  limit?: number,
): Promise<PaginatedArtifacts> {
  const pageSize = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  // Build WHERE clause
  const whereClause = kind ? `WHERE is_active = 1 AND kind = ?1` : `WHERE is_active = 1`;

  // Get total count for pagination
  const countStmt = kind
    ? db.prepare(`SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1 AND kind = ?1`)
    : db.prepare(`SELECT COUNT(*) as count FROM artifacts WHERE is_active = 1`);

  const countResult = await countStmt.bind(kind || "skill").first<Awaited<ReturnType<typeof countStmt>>>();
  const total = (countResult?.count ?? 0);
  const totalPages = Math.ceil(total / pageSize);

  // Get the actual artifacts
  const query = kind
    ? db.prepare(
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
    : db.prepare(
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
    );

  const resultsStmt = kind
    ? query.bind(kind, pageSize, offset)
    : query.bind(pageSize, offset);

  const { results } = await resultsStmt.all<Awaited<ReturnType<typeof query>>>();
  const artifacts = results ?? [];

  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  // Build URLs for pagination (simplified - would need full URL context)
  const nextUrl = hasNext ? `/skills?page=${page + 1}` : null;
  const prevUrl = hasPrev ? `/skills?page=${page - 1}` : null;

  return {
    artifacts,
    page,
    totalPages,
    hasNext,
    hasPrev,
    nextUrl,
    prevUrl,
  };
}

/**
 * Clamp a limit parameter to the allowed range.
 * 
 * @param limit The limit from the query string
 * @returns The clamped limit value
 */
export function clampLimit(limit: number): number {
  if (limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * Validate a page number parameter.
 * 
 * @param page The page number from the query string
 * @returns The validated page number (minimum 1)
 */
export function clampPage(page: number): number {
  return Math.max(page, 1);
}