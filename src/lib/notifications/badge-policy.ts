/**
 * When the top-bar badge poll is allowed to ask the server, and how to read the
 * answer.
 *
 * Split out of `use-top-bar-badges` so it can be tested without a DOM or a
 * React renderer — the same reason `nav-visibility.ts` is separate from the
 * reporting sidebar. The hook is then thin glue over these decisions, and the
 * decisions are where the bugs actually were:
 *
 *   no auth gate      -> polled on a timer with no idea if anyone was signed in
 *   no stop on 401    -> `if (!res.ok) return` swallowed it and the timer ran on
 *   no visibility gate-> background tabs polled a badge nobody could see
 *
 * A session that expired under an open tab therefore produced one 401 a minute,
 * per tab, forever, silently.
 */

/** Reasons the poll is not running, for the hook to act on and tests to assert. */
export type PollDecision = 'poll' | 'unauthenticated' | 'denied' | 'hidden';

export interface PollConditions {
  /** next-auth session status has resolved to authenticated. */
  authed: boolean;
  /** The server has already answered 401/403 for this mount. */
  denied: boolean;
  /** document.hidden — the tab is backgrounded. */
  hidden: boolean;
}

/**
 * Order matters, and it is the order of certainty rather than convenience:
 * being signed out is a fact about the session, being denied is a fact the
 * server stated, and being hidden is merely the current moment. Checking
 * `hidden` first would report a signed-out user as "hidden" and imply the poll
 * resumes when they look at the tab, which it must not.
 */
export function pollDecision(c: PollConditions): PollDecision {
  if (!c.authed) return 'unauthenticated';
  if (c.denied) return 'denied';
  if (c.hidden) return 'hidden';
  return 'poll';
}

export function shouldPoll(c: PollConditions): boolean {
  return pollDecision(c) === 'poll';
}

/**
 * Whether a response status means "stop asking" rather than "try again later".
 *
 * 401 and 403 cannot be fixed by repeating the same request on a timer — only
 * signing in again can, and that remounts the hook. Everything else (a 500, a
 * 502 from a restarting upstream, a network blip) is transient and the next
 * tick should retry.
 */
export function isAuthDenied(status: number): boolean {
  return status === 401 || status === 403;
}

/** Defensive read: the badge should never render NaN because a field moved. */
export function readUnreadCount(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const raw = (data as { unreadCount?: unknown }).unreadCount;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}
