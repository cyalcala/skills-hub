// Change detection for artifacts.
//
// The hash covers IDENTITY fields only — never stars, never timestamps. Those
// churn on every observation, and hashing them would mark the entire corpus
// "changed" every single pulse, defeating the purpose and burning the enrich
// budget. Getting this input set wrong is expensive to discover and expensive
// to fix (it invalidates every stored hash), so it is fixed by contract in
// specs/SPEC-db.md. Changing it requires an explicit migration.

import type { ArtifactInput } from "./artifact-schema";

/** Fields that participate in the hash, in a fixed order. */
export interface HashableIdentity {
  kind: string;
  name: string;
  summary: string;
  source_url: string;
  license: string;
  tags: string[];
}

/** Project an ArtifactInput down to its identity, normalizing as it goes. */
export function toHashableIdentity(input: ArtifactInput): HashableIdentity {
  return {
    kind: input.kind,
    name: normalizeText(input.name),
    summary: normalizeText(input.summary ?? ""),
    source_url: normalizeUrl(input.source_url),
    license: normalizeText(input.license ?? ""),
    // Sorted so tag reordering upstream is not a content change.
    tags: [...(input.tags ?? [])].map(normalizeText).filter(Boolean).sort(),
  };
}

/**
 * Serialize identity to a stable string. Field order is explicit rather than
 * relying on JSON.stringify key order, which is only guaranteed for the
 * insertion order of a literal — too fragile to hash against.
 */
export function serializeIdentity(id: HashableIdentity): string {
  return [
    id.kind,
    id.name,
    id.summary,
    id.source_url,
    id.license,
    id.tags.join(","),
  ].join("\u0000"); // NUL separator: cannot appear in any normalized field
}

/** SHA-256 hex of the serialized identity. Uses WebCrypto, available in Workers. */
export async function computeContentHash(input: ArtifactInput): Promise<string> {
  const serialized = serializeIdentity(toHashableIdentity(input));
  const bytes = new TextEncoder().encode(serialized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Collapse whitespace and trim. Keeps hashes stable across cosmetic edits. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Canonicalize a URL so the same resource hashes identically:
 * lowercase host, drop the default port, drop a trailing slash, drop tracking
 * params, and sort what remains. Path case is preserved — it is significant on
 * GitHub (`owner/Repo` != `owner/repo` for display, though not for routing).
 */
export function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value.trim();
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  const TRACKING = /^(utm_|ref$|referrer$|source$|gclid$|fbclid$)/i;
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  let out = url.toString();
  if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
  return out;
}
