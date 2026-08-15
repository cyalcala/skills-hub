import { describe, it, expect } from "vitest";
import {
  toHashableIdentity,
  serializeIdentity,
  computeContentHash,
  normalizeText,
  normalizeUrl,
} from "../src/lib/content-hash";
import type { ArtifactInput } from "../src/lib/artifact-schema";

const artifact = (o: Partial<ArtifactInput> = {}): ArtifactInput => ({
  kind: "skill",
  name: "Example Skill",
  source_url: "https://github.com/acme/example",
  ...o,
});

describe("normalizeText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeText("  a   b \n c  ")).toBe("a b c");
  });
});

describe("normalizeUrl", () => {
  it("lowercases the host but preserves path case", () => {
    expect(normalizeUrl("https://GitHub.com/Acme/Example")).toBe("https://github.com/Acme/Example");
  });

  it("strips fragments and tracking params", () => {
    expect(normalizeUrl("https://x.dev/a?utm_source=tw&keep=1#frag")).toBe("https://x.dev/a?keep=1");
  });

  it("sorts remaining query params so order is not a change", () => {
    expect(normalizeUrl("https://x.dev/a?b=2&a=1")).toBe(normalizeUrl("https://x.dev/a?a=1&b=2"));
  });

  it("drops a trailing slash except at the root", () => {
    expect(normalizeUrl("https://x.dev/a/")).toBe("https://x.dev/a");
    expect(normalizeUrl("https://x.dev/")).toBe("https://x.dev/");
  });

  it("returns unparseable input untouched rather than throwing", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("toHashableIdentity", () => {
  it("sorts tags so upstream reordering is not a content change", () => {
    expect(toHashableIdentity(artifact({ tags: ["z", "a", "m"] })).tags).toEqual(["a", "m", "z"]);
  });

  it("drops empty tags", () => {
    expect(toHashableIdentity(artifact({ tags: ["a", "  ", ""] })).tags).toEqual(["a"]);
  });
});

describe("serializeIdentity", () => {
  it("keeps field boundaries unambiguous", () => {
    // Without a separator that cannot occur in a field, these two distinct
    // artifacts would serialize identically and collide.
    const a = serializeIdentity(toHashableIdentity(artifact({ name: "a b", summary: "c" })));
    const b = serializeIdentity(toHashableIdentity(artifact({ name: "a", summary: "b c" })));
    expect(a).not.toBe(b);
  });
});

describe("computeContentHash", () => {
  it("is stable across calls", async () => {
    const input = artifact({ summary: "does a thing", license: "MIT", tags: ["x"] });
    expect(await computeContentHash(input)).toBe(await computeContentHash(input));
  });

  it("ignores churny fields — stars and timestamps must not change the hash", async () => {
    // The load-bearing property. If this breaks, every pulse marks the whole
    // corpus as changed and the enrich budget evaporates.
    const before = await computeContentHash(artifact({ stars: 1, source_updated_at: "2026-01-01T00:00:00Z" }));
    const after = await computeContentHash(artifact({ stars: 9999, source_updated_at: "2026-08-01T00:00:00Z" }));
    expect(before).toBe(after);
  });

  it("changes when an identity field changes", async () => {
    const before = await computeContentHash(artifact({ summary: "old" }));
    const after = await computeContentHash(artifact({ summary: "new" }));
    expect(before).not.toBe(after);
  });

  it("is insensitive to tag order but sensitive to tag content", async () => {
    const ab = await computeContentHash(artifact({ tags: ["a", "b"] }));
    const ba = await computeContentHash(artifact({ tags: ["b", "a"] }));
    const ac = await computeContentHash(artifact({ tags: ["a", "c"] }));
    expect(ab).toBe(ba);
    expect(ab).not.toBe(ac);
  });

  it("produces a 64-char hex digest", async () => {
    expect(await computeContentHash(artifact())).toMatch(/^[0-9a-f]{64}$/);
  });
});
