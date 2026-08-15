import { defineConfig } from "vitest/config";

// Unit tests cover PURE logic only — scoring, hashing, chunking, lock
// arithmetic, query construction. Anything needing real SQLite runs as an
// integration test against `wrangler d1 --local`, not here. Keeping this suite
// dependency-free is what makes it runnable on a clean clone with no
// Cloudflare account.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
