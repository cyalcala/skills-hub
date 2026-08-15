// The ingest wire contract.
//
// Owned by the `ingest` module (specs/SPEC-ingest.md). Harvest adapters conform
// to this shape; they do not extend it. Adding a field here is a spec change
// that ripples to the schema, the adapters, and the public site — treat it as
// an interface revision, not a tweak.

export const ARTIFACT_KINDS = ["skill", "mcp", "ruleset", "subagent", "command"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const INSTALL_TARGETS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "opencode",
  "windsurf",
  "zed",
  "continue",
  "generic",
] as const;
export type InstallTarget = (typeof INSTALL_TARGETS)[number];

/** One discovered artifact, as produced by a harvest adapter. */
export interface ArtifactInput {
  kind: ArtifactKind;
  name: string;
  /** Canonical public URL. This is the dedupe key — it must be stable across runs. */
  source_url: string;
  summary?: string | null;
  description?: string | null;
  repo_full_name?: string | null;
  repo_host?: "github" | "gitlab" | "other" | null;
  homepage_url?: string | null;
  license?: string | null;
  author?: string | null;
  tags?: string[];
  install_target?: InstallTarget[];
  version?: string | null;
  stars?: number;
  forks?: number;
  /** Upstream's own last-modified, ISO-8601 UTC. */
  source_updated_at?: string | null;
}

export interface IngestBody {
  /** Which agent produced this batch — recorded in `source_runs.agent`. */
  agent: string;
  /** Optional FK into `sources`, when the batch came from a registered source. */
  source_id?: number | null;
  artifacts: ArtifactInput[];
}

export interface ValidationIssue {
  index: number;
  field: string;
  message: string;
}

const MAX_NAME = 200;
const MAX_SUMMARY = 300;
const MAX_DESCRIPTION = 4000;
const MAX_TAGS = 25;
const MAX_BATCH = 500;

/**
 * Validate a batch. Returns every issue found rather than throwing on the
 * first, so an adapter author sees all their problems in one run.
 *
 * Policy: a malformed row fails the batch. We do not silently drop rows — the
 * model repo's audit found silent drops reporting misleading success counts,
 * which is how a broken adapter stays broken for weeks.
 */
export function validateIngestBody(body: unknown): {
  ok: boolean;
  issues: ValidationIssue[];
  value?: IngestBody;
} {
  const issues: ValidationIssue[] = [];
  const fail = (index: number, field: string, message: string) =>
    issues.push({ index, field, message });

  if (typeof body !== "object" || body === null) {
    return { ok: false, issues: [{ index: -1, field: "body", message: "expected an object" }] };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.agent !== "string" || b.agent.trim() === "") {
    fail(-1, "agent", "required non-empty string");
  }
  if (b.source_id != null && typeof b.source_id !== "number") {
    fail(-1, "source_id", "must be a number or null");
  }
  if (!Array.isArray(b.artifacts)) {
    return { ok: false, issues: [...issues, { index: -1, field: "artifacts", message: "expected an array" }] };
  }
  if (b.artifacts.length === 0) {
    fail(-1, "artifacts", "batch is empty");
  }
  if (b.artifacts.length > MAX_BATCH) {
    fail(-1, "artifacts", `batch of ${b.artifacts.length} exceeds max ${MAX_BATCH}; chunk upstream`);
  }

  b.artifacts.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      fail(i, "artifact", "expected an object");
      return;
    }
    const a = raw as Record<string, unknown>;

    if (typeof a.kind !== "string" || !ARTIFACT_KINDS.includes(a.kind as ArtifactKind)) {
      fail(i, "kind", `must be one of: ${ARTIFACT_KINDS.join(", ")}`);
    }
    if (typeof a.name !== "string" || a.name.trim() === "") {
      fail(i, "name", "required non-empty string");
    } else if (a.name.length > MAX_NAME) {
      fail(i, "name", `exceeds ${MAX_NAME} chars`);
    }
    if (typeof a.source_url !== "string") {
      fail(i, "source_url", "required string");
    } else if (!isSafeHttpUrl(a.source_url)) {
      fail(i, "source_url", "must be an absolute http(s) URL");
    }
    if (a.summary != null && typeof a.summary === "string" && a.summary.length > MAX_SUMMARY) {
      fail(i, "summary", `exceeds ${MAX_SUMMARY} chars; truncate upstream`);
    }
    if (
      a.description != null &&
      typeof a.description === "string" &&
      a.description.length > MAX_DESCRIPTION
    ) {
      fail(i, "description", `exceeds ${MAX_DESCRIPTION} chars; truncate upstream`);
    }
    if (a.tags != null) {
      if (!Array.isArray(a.tags)) fail(i, "tags", "must be an array of strings");
      else if (a.tags.length > MAX_TAGS) fail(i, "tags", `exceeds ${MAX_TAGS} tags`);
      else if (!a.tags.every((t) => typeof t === "string")) fail(i, "tags", "all tags must be strings");
    }
    if (a.install_target != null) {
      if (!Array.isArray(a.install_target)) {
        fail(i, "install_target", "must be an array");
      } else {
        for (const t of a.install_target) {
          if (!INSTALL_TARGETS.includes(t as InstallTarget)) {
            fail(i, "install_target", `unknown target "${String(t)}"`);
          }
        }
      }
    }
    for (const numeric of ["stars", "forks"] as const) {
      const v = a[numeric];
      if (v != null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
        fail(i, numeric, "must be a non-negative finite number");
      }
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value: body as unknown as IngestBody };
}

/**
 * Absolute http(s) only. Rejects `javascript:`, `data:`, and protocol-relative
 * URLs. Used both here and by the outbound click redirect, where allowing an
 * arbitrary scheme would turn the redirect into an open proxy.
 */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" || url.protocol === "http:";
}
