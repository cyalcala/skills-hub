import { describe, it, expect } from "vitest";
import { validateIngestBody, isSafeHttpUrl } from "../src/lib/artifact-schema";

const good = {
  agent: "scout",
  artifacts: [{ kind: "skill", name: "Example", source_url: "https://github.com/acme/x" }],
};

describe("isSafeHttpUrl", () => {
  it("accepts absolute http and https", () => {
    expect(isSafeHttpUrl("https://x.dev/a")).toBe(true);
    expect(isSafeHttpUrl("http://x.dev/a")).toBe(true);
  });

  it("rejects dangerous and relative schemes", () => {
    // These matter twice: here, and in the outbound click redirect, where a
    // permissive check would make the redirect an open proxy.
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeHttpUrl("//x.dev/a")).toBe(false);
    expect(isSafeHttpUrl("/relative")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("validateIngestBody", () => {
  it("accepts a well-formed batch", () => {
    const result = validateIngestBody(good);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a non-object body", () => {
    expect(validateIngestBody(null).ok).toBe(false);
    expect(validateIngestBody("nope").ok).toBe(false);
  });

  it("requires a non-empty agent", () => {
    const result = validateIngestBody({ ...good, agent: "  " });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "agent")).toBe(true);
  });

  it("rejects an empty batch", () => {
    const result = validateIngestBody({ agent: "scout", artifacts: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "artifacts")).toBe(true);
  });

  it("rejects an oversized batch and says to chunk upstream", () => {
    const artifacts = Array.from({ length: 501 }, (_, i) => ({
      kind: "skill",
      name: `n${i}`,
      source_url: `https://x.dev/${i}`,
    }));
    const result = validateIngestBody({ agent: "scout", artifacts });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /chunk upstream/.test(i.message))).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = validateIngestBody({
      agent: "scout",
      artifacts: [{ kind: "plugin", name: "x", source_url: "https://x.dev" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "kind")).toBe(true);
  });

  it("rejects an unsafe source_url", () => {
    const result = validateIngestBody({
      agent: "scout",
      artifacts: [{ kind: "skill", name: "x", source_url: "javascript:alert(1)" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "source_url")).toBe(true);
  });

  it("reports EVERY issue rather than stopping at the first", () => {
    // An adapter author should see all their problems in one run.
    const result = validateIngestBody({
      agent: "",
      artifacts: [
        { kind: "nope", name: "", source_url: "bad" },
        { kind: "skill", name: "ok", source_url: "also-bad" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("reports the offending row index so the author can find it", () => {
    const result = validateIngestBody({
      agent: "scout",
      artifacts: [
        { kind: "skill", name: "fine", source_url: "https://x.dev/1" },
        { kind: "skill", name: "broken", source_url: "nope" },
      ],
    });
    expect(result.issues[0]?.index).toBe(1);
  });

  it("rejects negative star counts", () => {
    const result = validateIngestBody({
      agent: "scout",
      artifacts: [{ kind: "skill", name: "x", source_url: "https://x.dev", stars: -5 }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "stars")).toBe(true);
  });

  it("rejects an unknown install target", () => {
    const result = validateIngestBody({
      agent: "scout",
      artifacts: [
        { kind: "skill", name: "x", source_url: "https://x.dev", install_target: ["emacs"] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "install_target")).toBe(true);
  });
});
