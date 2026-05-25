/**
 * In-memory per-IP rate limiter for public form submissions.
 *
 * Process-local — fine for single-instance deploys (our PM2 setup runs one
 * process per droplet, and the dev DB is single-instance). When we
 * horizontally scale this needs to move to Redis or a DB-backed table so
 * the budget is shared across replicas.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_WINDOW = 5;

// Module-level state — survives between requests in the same Node process.
// We never .clear() this; entries naturally expire when `resetAt` passes.
const buckets = new Map<string, Bucket>();

// Periodic GC keeps the map from growing unbounded on long-running
// processes. Runs every 5 minutes and is cheap (Map iteration).
let gcTimer: NodeJS.Timeout | null = null;
function ensureGcRunning() {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 5 * 60 * 1000);
  // Unref so the timer doesn't keep the event loop alive in tests.
  gcTimer.unref?.();
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the bucket resets — useful for Retry-After headers. */
  retryAfter: number;
}

/**
 * Check if a key (typically IP, optionally combined with the form slug)
 * is under the rate limit. Increments the counter when allowed.
 *
 * Returns `{ ok: false, retryAfter }` when over the budget, so the caller
 * can respond with HTTP 429.
 */
export function checkRateLimit(key: string): RateLimitResult {
  ensureGcRunning();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return {
      ok: false,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Test helper — exposed only so the unit tests (if added) can reset between cases. */
export function _resetRateLimitForTests() {
  buckets.clear();
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }
}
