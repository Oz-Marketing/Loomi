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

/**
 * The badge answers "is there something you have not looked at yet", not "how
 * many rows are unread". Those come apart the moment someone opens the panel,
 * reads the list, and closes it without clicking each row: they have seen
 * everything, so the bell must go dark, but the rows are still legitimately
 * unread and must stay that way in the panel.
 *
 * The bridge is a watermark — the unread count at the moment the panel was
 * closed. Anything at or below it has been seen; anything above it is new.
 *
 * Without it, closing the panel would clear the badge for at most sixty
 * seconds: the next poll returns the same unread count and lights it again,
 * which is exactly the behaviour that teaches people to ignore the bell.
 */
export function visibleBadgeCount(unread: number, seenWatermark: number): number {
  if (!Number.isFinite(unread) || unread <= 0) return 0;
  return unread > seenWatermark ? unread : 0;
}

/**
 * The watermark must fall as well as rise, or it goes stale in the one
 * direction that matters. Dismiss at 5, then mark three of those read: 2
 * unread. Three genuinely new notifications arrive — back to 5, still not
 * above a watermark of 5, badge stays dark and the new ones are invisible.
 *
 * Clamping to the current unread count on every refresh keeps the watermark
 * meaning "the number you had already seen", which can only ever be as large
 * as the number that exists.
 */
export function clampWatermark(unread: number, seenWatermark: number): number {
  if (!Number.isFinite(unread) || unread < 0) return 0;
  return Math.min(seenWatermark, Math.floor(unread));
}

/**
 * The watermark outlives the page.
 *
 * Holding it in component state alone means a reload re-lights a badge the
 * user deliberately dismissed thirty seconds ago, which reads as the dismissal
 * not having worked. localStorage is the same place the changelog dot keeps
 * its "last seen" mark, for the same reason and with the same caveat: it is
 * per-browser, so dismissing on a laptop leaves the phone lit. That is the
 * correct trade — "seen" is a fact about a person at a screen, and the
 * alternative is a write to the server on every panel close.
 */
const WATERMARK_KEY = 'loomi.notifications.seenWatermark';

export function readSeenWatermark(): number {
  try {
    const raw = window.localStorage.getItem(WATERMARK_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    // Private mode, disabled storage, or no window. A forgotten watermark just
    // shows the badge again — never a reason to break the top bar.
    return 0;
  }
}

export function writeSeenWatermark(n: number): void {
  try {
    window.localStorage.setItem(WATERMARK_KEY, String(Math.max(0, Math.floor(n))));
  } catch {
    /* see readSeenWatermark */
  }
}
