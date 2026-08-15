import { describe, it, expect } from "vitest";
import { scoreArtifact, daysSince, WEIGHTS, type ScoreInput } from "../src/lib/quality";

// A fixed clock. Every freshness assertion is relative to this, which is the
// whole reason `now` is injected rather than read.
const NOW = new Date("2026-08-15T00:00:00Z");

function base(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return { kind: "skill", name: "example", ...overrides };
}

describe("daysSince", () => {
  it("returns null for missing or unparseable input", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince("not-a-date", NOW)).toBeNull();
  });

  it("counts whole days elapsed", () => {
    expect(daysSince("2026-08-15T00:00:00Z", NOW)).toBe(0);
    expect(daysSince("2026-08-05T00:00:00Z", NOW)).toBe(10);
  });

  it("clamps future timestamps to zero rather than going negative", () => {
    // Upstream clock skew must not produce a nonsensical negative age.
    expect(daysSince("2027-01-01T00:00:00Z", NOW)).toBe(0);
  });
});

describe("scoreArtifact — dimension isolation", () => {
  it("scores a completely bare artifact at only the unknown-date credit", () => {
    const { score, breakdown } = scoreArtifact(base(), NOW);
    // Every dimension floors at 0 except freshness, which grants 4 points for
    // an unknown upstream date — unknown is not the same as stale.
    expect(score).toBe(4);
    expect(breakdown.metadata).toBe(0);
    expect(breakdown.documentation).toBe(0);
    expect(breakdown.licensing).toBe(0);
    expect(breakdown.popularity).toBe(0);
    // Unknown date earns partial credit, not zero — unknown != stale.
    expect(breakdown.freshness).toBe(4);
  });

  it("caps each dimension at its declared weight", () => {
    const { breakdown } = scoreArtifact(
      base({
        has_valid_frontmatter: true,
        summary: "x".repeat(120),
        tags: ["a", "b", "c", "d"],
        install_target: ["claude-code"],
        has_readme: true,
        has_examples: true,
        description: "y".repeat(2000),
        license: "MIT",
        stars: 100_000,
        source_updated_at: "2026-08-14T00:00:00Z",
      }),
      NOW,
    );
    expect(breakdown.metadata).toBeLessThanOrEqual(WEIGHTS.metadata);
    expect(breakdown.documentation).toBeLessThanOrEqual(WEIGHTS.documentation);
    expect(breakdown.freshness).toBeLessThanOrEqual(WEIGHTS.freshness);
    expect(breakdown.licensing).toBeLessThanOrEqual(WEIGHTS.licensing);
    expect(breakdown.popularity).toBeLessThanOrEqual(WEIGHTS.popularity);
  });

  it("never exceeds 100 overall", () => {
    const { score } = scoreArtifact(
      base({
        has_valid_frontmatter: true,
        summary: "x".repeat(300),
        tags: ["a", "b", "c"],
        install_target: ["claude-code", "cursor"],
        has_readme: true,
        has_examples: true,
        description: "y".repeat(4000),
        license: "MIT",
        stars: 1_000_000,
        source_updated_at: "2026-08-15T00:00:00Z",
      }),
      NOW,
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(90);
  });
});

describe("scoreArtifact — freshness decay", () => {
  const withAge = (iso: string) => scoreArtifact(base({ source_updated_at: iso }), NOW).breakdown.freshness;

  it("awards full marks inside 30 days", () => {
    expect(withAge("2026-08-01T00:00:00Z")).toBe(WEIGHTS.freshness);
  });

  it("decays monotonically as the artifact ages", () => {
    const recent = withAge("2026-07-01T00:00:00Z"); // ~45d
    const mid = withAge("2026-02-01T00:00:00Z"); // ~195d
    const old = withAge("2025-09-01T00:00:00Z"); // ~348d
    expect(recent).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
  });

  it("bottoms out for artifacts abandoned over two years", () => {
    expect(withAge("2023-01-01T00:00:00Z")).toBe(0);
  });
});

describe("scoreArtifact — popularity is capped and logarithmic", () => {
  it("compresses the star tail so one viral repo cannot dominate", () => {
    const at = (stars: number) => scoreArtifact(base({ stars }), NOW).breakdown.popularity;
    expect(at(0)).toBe(0);
    expect(at(10)).toBe(5);
    expect(at(100)).toBe(10);
    expect(at(1000)).toBe(15);
    // Two orders of magnitude more stars is worth 5 more points, not 500.
    expect(at(100_000)).toBe(WEIGHTS.popularity);
  });

  it("lets a well-documented new skill outscore a stale famous one", () => {
    const newcomer = scoreArtifact(
      base({
        has_valid_frontmatter: true,
        summary: "A thorough, well-scoped summary of what this skill does.",
        tags: ["testing", "ci", "quality"],
        install_target: ["claude-code"],
        has_readme: true,
        has_examples: true,
        description: "z".repeat(1000),
        license: "MIT",
        stars: 3,
        source_updated_at: "2026-08-10T00:00:00Z",
      }),
      NOW,
    );
    const staleFamous = scoreArtifact(
      base({ stars: 50_000, license: "MIT", source_updated_at: "2023-01-01T00:00:00Z" }),
      NOW,
    );
    expect(newcomer.score).toBeGreaterThan(staleFamous.score);
  });
});

describe("scoreArtifact — licensing", () => {
  it("rewards permissive licenses over restrictive ones over none", () => {
    const permissive = scoreArtifact(base({ license: "MIT" }), NOW).breakdown.licensing;
    const restrictive = scoreArtifact(base({ license: "GPL-3.0" }), NOW).breakdown.licensing;
    const none = scoreArtifact(base({ license: null }), NOW).breakdown.licensing;
    expect(permissive).toBeGreaterThan(restrictive);
    expect(restrictive).toBeGreaterThan(none);
  });

  it("treats NOASSERTION as no license at all", () => {
    expect(scoreArtifact(base({ license: "NOASSERTION" }), NOW).breakdown.licensing).toBe(0);
  });
});

describe("scoreArtifact — transparency", () => {
  it("explains every deduction it makes", () => {
    const { notes } = scoreArtifact(base(), NOW);
    expect(notes).toContain("No valid frontmatter detected.");
    expect(notes).toContain("Missing a description/summary.");
    expect(notes).toContain("No README found.");
    expect(notes).toContain("No license declared — reuse rights are unclear.");
  });

  it("is deterministic — same input and clock yields an identical result", () => {
    const input = base({ license: "MIT", stars: 42, source_updated_at: "2026-06-01T00:00:00Z" });
    expect(scoreArtifact(input, NOW)).toEqual(scoreArtifact(input, NOW));
  });
});
