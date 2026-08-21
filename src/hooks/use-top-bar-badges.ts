'use client';

/**
 * The two unread badges every top bar carries: notification count, and whether
 * the changelog has something the user has not seen.
 *
 * This existed three times — Studio, Reporting and App each had their own copy
 * of the same fetch, the same `if (!res.ok) return`, and the same bare
 * `setInterval(..., 60_000)`. Consolidating is a net deletion, and it fixes
 * four things that were wrong in all three copies at once:
 *
 * AUTH. The poll ran on a timer with no idea whether anyone was signed in. When
 * a session expired under an open tab, every tab kept asking once a minute,
 * forever, and every answer was 401. `if (!res.ok) return` swallowed it, so
 * nothing surfaced and nothing stopped — it just quietly generated load. That
 * is the shape the audit caught; it read it as "polling while logged out",
 * which is not quite right (the top bar does not render on /login) but the
 * defect underneath is real.
 *
 * A 401 or 403 now stops the poll for good. Retrying an authorization failure
 * on a fixed interval cannot fix it — only signing in again can, and that
 * remounts this.
 *
 * VISIBILITY. A background tab has no badge anyone can see, so it has no reason
 * to ask. Polling pauses while hidden and does one immediate refresh on the way
 * back, which is also what makes the badge correct when you return to a tab
 * that has been open all afternoon.
 *
 * CANCELLATION. The in-flight request is aborted on unmount, so a slow response
 * cannot land in a component that is gone.
 *
 * DRIFT. Each poll is scheduled after the previous one settles rather than on a
 * fixed interval, so a slow response cannot stack requests on top of each other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { hasUnseenChangelog } from '@/lib/changelog';
import {
  isAuthDenied,
  readUnreadCount,
  shouldPoll,
} from '@/lib/notifications/badge-policy';

const POLL_MS = 60_000;

export interface TopBarBadges {
  /** Unread notification count. 0 while unauthenticated. */
  unreadNotifications: number;
  /** Set directly by the notifications panel, which knows better than a poll. */
  setUnreadNotifications: (n: number) => void;
  /** Re-check now — after opening the panel, or marking things read. */
  refreshNotifications: () => void;
  /** Whether the changelog has an entry newer than the last one seen. */
  hasUnseenChangelogEntry: boolean;
  /** Clear the dot when the panel opens; re-check when it closes. */
  setHasUnseenChangelogEntry: (v: boolean) => void;
  refreshChangelog: () => void;
}

export function useTopBarBadges(): TopBarBadges {
  const { status } = useSession();
  const authed = status === 'authenticated';

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [hasUnseenChangelogEntry, setHasUnseenChangelogEntry] = useState(false);

  // Set when the server says we are not allowed to ask. Survives re-renders and
  // deliberately is NOT state — flipping it must not itself cause a render.
  const deniedRef = useRef(false);
  // A SET, not a single controller. Both badges share this fetcher, and with
  // one shared ref the notifications poll and the changelog check race on
  // mount — whichever starts second aborts the first, so the changelog dot
  // silently never appears. Each call owns its own controller; the set exists
  // only so unmount can cancel whatever is still in flight.
  const inFlightRef = useRef<Set<AbortController>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJson = useCallback(async (url: string): Promise<unknown | null> => {
    if (deniedRef.current) return null;
    const controller = new AbortController();
    inFlightRef.current.add(controller);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (isAuthDenied(res.status)) {
        // Not a transient failure. Stop asking until something remounts us.
        deniedRef.current = true;
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      // Includes the abort on unmount, which is not an error worth reporting.
      return null;
    } finally {
      inFlightRef.current.delete(controller);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!authed) return;
    const data = await fetchJson('/api/notifications?unreadOnly=1&limit=1');
    if (data) setUnreadNotifications(readUnreadCount(data));
  }, [authed, fetchJson]);

  const refreshChangelog = useCallback(async () => {
    if (!authed) return;
    const data = (await fetchJson('/api/changelog')) as { entries?: [] } | null;
    // hasUnseenChangelog reads localStorage, so it must not run on the server.
    if (data) setHasUnseenChangelogEntry(hasUnseenChangelog(data.entries || []));
  }, [authed, fetchJson]);

  // Changelog is checked once per mount, not polled — a release note that
  // arrives while someone is mid-session can wait for their next navigation.
  useEffect(() => {
    if (!authed) return;
    void refreshChangelog();
  }, [authed, refreshChangelog]);

  // Notifications poll, paused while the tab is hidden.
  useEffect(() => {
    if (!authed) {
      setUnreadNotifications(0);
      return;
    }
    // A fresh sign-in is a fresh chance; clear any previous denial.
    deniedRef.current = false;
    let cancelled = false;

    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const tick = async () => {
      if (cancelled) return;
      if (!shouldPoll({ authed, denied: deniedRef.current, hidden: document.hidden })) return;
      await refreshNotifications();
      if (cancelled || deniedRef.current) return;
      // Scheduled AFTER the response, so a slow request cannot stack.
      clear();
      timerRef.current = setTimeout(tick, POLL_MS);
    };

    const onVisibility = () => {
      if (document.hidden) {
        clear();
        return;
      }
      // Back on screen: refresh at once, then resume the cadence.
      void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clear();
      for (const c of inFlightRef.current) c.abort();
      inFlightRef.current.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authed, refreshNotifications]);

  return {
    unreadNotifications,
    setUnreadNotifications,
    refreshNotifications: () => void refreshNotifications(),
    hasUnseenChangelogEntry,
    setHasUnseenChangelogEntry,
    refreshChangelog: () => void refreshChangelog(),
  };
}
