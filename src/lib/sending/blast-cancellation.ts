/**
 * Stopping a blast that is already sending.
 *
 * `processEmailBlast` / `processSmsBlast` load their pending recipients once
 * and then work through them under a concurrency limiter. A 10k-recipient
 * blast therefore lives for minutes, and flipping the row's status to
 * `canceled` in the database does nothing on its own — the loop is already
 * holding its list in memory and will keep sending.
 *
 * So the send loop has to ask. Asking per recipient would put one query in
 * front of every message; this gate collapses that into one query per window
 * no matter how many tasks check it, and shares a single in-flight query
 * between concurrent callers.
 *
 * The window is bounded two ways, because either alone leaves a bad case:
 *
 *   ttlMs    — a slow send (SendGrid latency, a warm-up-throttled trickle)
 *              could otherwise sit for minutes on one stale answer.
 *   maxCalls — a fast send could otherwise push hundreds of messages through
 *              a single one-second window. Someone cancelling a blast cares
 *              how many MORE people got it, not how many seconds elapsed, so
 *              the message count is the bound that matches the question.
 *
 * Some overshoot is inherent: mail already handed to SendGrid cannot be
 * recalled. What these two bounds buy is that the overshoot is small and can
 * be stated.
 */

/** Written onto recipient rows that a cancel stopped before they were sent. */
export const BLAST_CANCELED_ERROR = 'Canceled before send';

/** Default staleness window for a cancellation answer, in milliseconds. */
export const CANCEL_GATE_TTL_MS = 1_000;

/** Default number of sends that may pass on one cached answer. */
export const CANCEL_GATE_MAX_CALLS = 25;

export interface CancelGateOptions {
  ttlMs?: number;
  maxCalls?: number;
  /** Injectable clock — tests drive this instead of waiting in real time. */
  now?: () => number;
}

/**
 * Wrap a "has this blast been canceled?" query in a TTL cache.
 *
 * Latches once it answers true: a cancel is terminal, so there is no reason
 * to keep querying after the first positive, and no path that un-cancels a
 * row mid-send.
 */
export function createCancelGate(
  isCanceled: () => Promise<boolean>,
  options?: CancelGateOptions,
): () => Promise<boolean> {
  const ttlMs = options?.ttlMs ?? CANCEL_GATE_TTL_MS;
  const maxCalls = Math.max(1, options?.maxCalls ?? CANCEL_GATE_MAX_CALLS);
  const now = options?.now ?? Date.now;

  let canceled = false;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let callsSinceCheck = 0;
  let inFlight: Promise<boolean> | null = null;

  return async function checkCanceled(): Promise<boolean> {
    if (canceled) return true;

    callsSinceCheck += 1;
    if (callsSinceCheck < maxCalls && now() - checkedAt < ttlMs) return false;

    // Concurrent tasks share one query rather than each firing their own.
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const result = await isCanceled();
        canceled = result;
        return result;
      } catch (err) {
        // A failed check must not abort a legitimate send — the blast keeps
        // going and the next check gets another chance.
        console.error('[blast-cancellation] cancel check failed', err);
        return false;
      } finally {
        checkedAt = now();
        callsSinceCheck = 0;
        inFlight = null;
      }
    })();

    return inFlight;
  };
}
