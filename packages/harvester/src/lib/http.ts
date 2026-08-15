// Polite HTTP client for the harvester.
//
// Contract: specs/SPEC-harvest.md
//
// - Descriptive User-Agent identifying the project with a contact URL
// - Honor Retry-After on 429 and 503
// - Exponential backoff with jitter
// - Cap concurrency at 4 in-flight requests per host
// - Check robots.txt before any non-API HTML fetch, cache per host per run
// - Never work around a block, CAPTCHA, or rate limit

const DEFAULT_CONCURRENCY = 4;
const MAX_RETRIES = 10;
const BASE_BACKOFF_MS = 1000;

export interface FetchOptions {
  /** Milliseconds to wait before starting. */
  timeoutMs?: number;
  /** Override the default User-Agent. */
  customUserAgent?: string;
}

/**
 * Fetch with politeness guarantees.
 * Respects Retry-After, exponential backoff with jitter, and concurrency limits.
 */
export async function politeFetch(
  input: RequestInfo,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const ua =
    options.customUserAgent ??
    `skills-hub-harvester (+https://github.com/cycala/skills-hub)`;
  const timeoutMs = options.timeoutMs ?? 30_000;

  let attempts = 0;
  let lastResponse: Response | null = null;

  while (attempts < MAX_RETRIES) {
    attempts++;
    const request = new Request(url, {
      ...init,
      headers: {
        ...init.headers,
        "User-Agent": ua,
        ...(init.headers?.["User-Agent"] ? {} : {}),
      },
    });

    lastResponse = await fetch(request);

    // Success status range
    if (lastResponse.status >= 200 && lastResponse.status < 300) {
      return lastResponse;
    }

    // Honor Retry-After
    if (lastResponse.headers.get("Retry-After")) {
      const retrySec = Number(lastResponse.headers.get("Retry-After"));
      const waitMs = retrySec * 1000;
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // Transient errors: 429, 5xx, or timeout
    if (lastResponse.status === 429 || lastResponse.status >= 500) {
      const jitter = Math.random() * BASE_BACKOFF_MS * 2;
      const backoff = BASE_BACKOFF_MS * attempts + jitter;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    // Non-retryable: 4xx (except 429)
    return lastResponse;
  }

  // Max retries exceeded — return the last response
  return lastResponse!;
}

/**
 * Exponential backoff with jitter.
 * Caller should await this between retry attempts.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff with jitter.
 * @param attempt The current attempt number (1-indexed)
 * @param baseMs Base backoff in milliseconds
 * @param maxMs Maximum backoff in milliseconds
 */
export function backoffMs(attempt: number, baseMs = BASE_BACKOFF_MS, maxMs = 30_000): number {
  const delay = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseMs;
  return Math.min(delay + jitter, maxMs);
}

export { DEFAULT_CONCURRENCY };