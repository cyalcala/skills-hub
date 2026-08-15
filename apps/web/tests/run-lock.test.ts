import { describe, it, expect } from "vitest";
import { acquireLock, releaseLock, isExpired, holderId, DEFAULT_TTL_SECONDS } from "../src/lib/run-lock";

describe("isExpired", () => {
  it("returns false for a non-expired lock", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    expect(isExpired("2026-01-15T11:00:00Z", now)).toBe(false);
  });

  it("returns true for an expired lock", () => {
    const now = new Date("2026-01-15T11:30:00Z");
    expect(isExpired("2026-01-15T11:00:00Z", now)).toBe(true);
  });

  it("returns true for a parseable but already-expired lock at the exact moment", () => {
    const now = new Date("2026-01-15T11:00:00Z");
    expect(isExpired("2026-01-15T11:00:00Z", now)).toBe(true);
  });
});

describe("holderId", () => {
  it("includes agent and runId", () => {
    expect(holderId("scout", "run-123")).toBe("scout@run-123");
  });

  it("falls back to 'local' when runId is undefined", () => {
    expect(holderId("scout", undefined)).toBe("scout@local");
  });
});

describe("DEFAULT_TTL_SECONDS", () => {
  it("is 20 minutes (1200 seconds)", () => {
    expect(DEFAULT_TTL_SECONDS).toBe(20 * 60);
  });
});

/* ── Integration tests (run with: npx wrangler d1 migrations apply DB --local && npx vitest run) ────*/

describe("acquireLock & releaseLock (integration)", () => {
  it("acquires a lock and releases it", async () => {
    const { DB } = (await import("../src/lib/db")).default;
    const now = new Date();
    const result = await acquireLock(DB, "test-lock-1", "test-agent", now);
    expect(result.acquired).toBe(true);

    const released = await releaseLock(DB, "test-lock-1", "test-agent");
    expect(released).toBe(true);

    // After release, the lock should be acquirable again
    const result2 = await acquireLock(DB, "test-lock-1", "test-agent", now);
    expect(result2.acquired).toBe(true);
  });

  it("prevents two holders simultaneously", async () => {
    const { DB } = (await import("../src/lib/db")).default;
    const now = new Date();

    // Acquire first lock
    const first = await acquireLock(DB, "test-lock-2", "agent-A", now);
    expect(first.acquired).toBe(true);

    // Second attempt should fail
    const second = await acquireLock(DB, "test-lock-2", "agent-B", now);
    expect(second.acquired).toBe(false);
    expect(second.heldBy).toBe("agent-A");

    // Release first lock
    await releaseLock(DB, "test-lock-2", "agent-A");

    // Now the second should be able to acquire
    const third = await acquireLock(DB, "test-lock-2", "agent-B", now);
    expect(third.acquired).toBe(true);
  });

  it("TTL expiration works correctly", async () => {
    const { DB } = (await import("../src/lib/db")).default;
    const now = new Date();
    // Set a very short TTL by using a past now + short ttl
    const result = await acquireLock(DB, "test-lock-3", "agent-X", now, 1); // 1 second TTL
    expect(result.acquired).toBe(true);

    // Simulate time passing beyond the TTL
    const later = new Date(now.getTime() + 2000); // 2 seconds later
    const expiredCheck = isExpired(result.expiresAt ?? "", later);
    expect(expiredCheck).toBe(true);
  });
});