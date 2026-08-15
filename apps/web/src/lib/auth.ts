// Shared cron/ingest authentication.
//
// Ported deliberately from cyalcala/va-freelance-hub, where a 2026-07 audit
// replaced five inlined `provided !== secret` comparisons. A short-circuiting
// compare leaks the matching-prefix length through its runtime (a timing side
// channel). This helper centralizes the check and uses a length-independent,
// constant-time compare. Do not "simplify" it back to `===`.

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Fold both into one accumulator via XOR so length differences do not
  // short-circuit; unequal lengths still fail via the seeded length flag.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** Extract the presented secret from either `Authorization: Bearer` or `x-cron-secret`. */
export function extractProvidedSecret(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return request.headers.get("x-cron-secret");
}

/**
 * True when the request carries the correct shared secret. Constant-time.
 * `proxySecret` is `env.PROXY_SECRET || env.CRON_SECRET`.
 *
 * Fails closed: a missing configured secret denies every request rather than
 * accidentally allowing all of them.
 */
export function isAuthorized(request: Request, proxySecret: string | undefined | null): boolean {
  if (!proxySecret) return false;
  const provided = extractProvidedSecret(request);
  if (!provided) return false;
  return timingSafeEqual(provided, proxySecret);
}
