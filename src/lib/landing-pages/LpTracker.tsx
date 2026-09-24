'use client';

/**
 * Invisible visitor-analytics client for a published landing page.
 *
 * Renders nothing. On mount, sets up:
 *  - Anonymous identity cookies (`loomi_lp_anon`, `loomi_lp_session`).
 *  - UTM capture: parses `utm_*` from the URL on first visit, persists
 *    them in `loomi_lp_utm` so subsequent events + form submissions
 *    inherit attribution.
 *  - Ad-click capture: a landing with `gclid` / `gbraid` / `wbraid` /
 *    `fbclid` / `msclkid` persists them in `loomi_lp_click` (see
 *    `lib/forms/click-ids`), so a form later in the visit still sends
 *    them. Its own cookie, not a field in `loomi_lp_utm`: the ad platforms
 *    honor a click for 90 days, and the UTM cookie's life stays as it was.
 *  - View event on initial render.
 *  - Scroll milestone events (25/50/75/100), each fired at most once
 *    per page-mount.
 *  - CTA click tracking: bubbles up `[data-loomi-track="cta"]`
 *    clicks. The tracked element's text + href travels in `meta`.
 *
 * Events POST via `navigator.sendBeacon` when available so they
 * survive unload; fallback is a fire-and-forget `fetch`. We never
 * await — analytics latency must not block the visitor.
 *
 * Designed to drop into either blocks-mode or html-mode public LP
 * routes (mounted once per page, alongside the rendered tree).
 */
import * as React from 'react';
import {
  LP_CLICK_COOKIE,
  LP_CLICK_TTL_DAYS,
  clickIdsFromSearch,
  mergeClickIds,
  readLpClickCookie,
} from '@/lib/forms/click-ids';

const ANON_COOKIE = 'loomi_lp_anon';
const SESSION_COOKIE = 'loomi_lp_session';
const UTM_COOKIE = 'loomi_lp_utm';

const ANON_TTL_DAYS = 365;
const SESSION_TTL_MIN = 30;
const UTM_TTL_DAYS = 30;

const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

interface LpTrackerProps {
  pageId: string;
  slug: string;
}

interface UtmTags {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export function LpTracker({ pageId, slug }: LpTrackerProps) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const anonId = ensureCookie(ANON_COOKIE, ANON_TTL_DAYS * 24 * 60);
    const sessionId = touchSessionCookie();
    const utm = captureUtmsFromUrl() ?? readUtmCookie();
    captureClickIdsFromUrl();

    const send = (
      type: string,
      meta?: Record<string, unknown>,
    ) => {
      postEvent({
        pageId,
        slug,
        type,
        sessionId,
        anonId,
        referrer: document.referrer || undefined,
        utm,
        meta,
      });
    };

    // ── View event ─────────────────────────────────────────────
    send('view');

    // ── Scroll milestones ──────────────────────────────────────
    // Track the FURTHEST depth reached so far. Fire each milestone
    // event at most once per mount.
    const firedMilestones = new Set<number>();
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const depthPct = computeScrollDepthPct();
        for (const m of SCROLL_MILESTONES) {
          if (depthPct >= m && !firedMilestones.has(m)) {
            firedMilestones.add(m);
            send(`scroll_${m}`, { scrollDepth: m });
          }
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    // Also fire once on mount in case the page is shorter than the
    // viewport (instant scroll_100 — still counts as "saw the whole
    // page").
    handleScroll();

    // ── CTA click bubbling ────────────────────────────────────
    const handleClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const tracked = target.closest<HTMLElement>('[data-loomi-track="cta"]');
      if (!tracked) return;
      const href = tracked.getAttribute('href') ?? tracked.dataset.loomiTrackHref ?? undefined;
      const label =
        tracked.dataset.loomiTrackLabel ??
        tracked.textContent?.trim().slice(0, 200) ??
        undefined;
      send('cta_click', { ctaHref: href, ctaLabel: label });
    };
    document.addEventListener('click', handleClick, true);

    // ── Form submission ───────────────────────────────────────
    // FormPublic dispatches this CustomEvent on successful submit.
    // The same event powers analytics here AND lets host pages hook
    // their own GTM/Meta pixel firing on the same signal.
    const handleFormSubmit = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { slug?: string; submissionId?: string }
        | undefined;
      send('form_submit', {
        formSlug: detail?.slug,
        submissionId: detail?.submissionId,
      });
    };
    window.addEventListener('loomi:form-submitted', handleFormSubmit);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('loomi:form-submitted', handleFormSubmit);
    };
  }, [pageId, slug]);

  return null;
}

// ── Network ────────────────────────────────────────────────────────

interface EventPayload {
  pageId: string;
  slug: string;
  type: string;
  sessionId?: string | null;
  anonId?: string | null;
  referrer?: string;
  utm?: UtmTags;
  meta?: Record<string, unknown>;
}

function postEvent(payload: EventPayload) {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon prefers a Blob payload with the right content-type
      // so the server's req.json() parser works without extra config.
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/lp-events', blob)) return;
    }
    // Fallback — fire and forget, keepalive lets it survive unload.
    void fetch('/api/lp-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // Analytics must never throw into the host page.
  }
}

// ── Cookies ────────────────────────────────────────────────────────

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, ttlMinutes: number) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function ensureCookie(name: string, ttlMinutes: number): string {
  const existing = readCookie(name);
  if (existing) return existing;
  const next = randomId();
  writeCookie(name, next, ttlMinutes);
  return next;
}

function touchSessionCookie(): string {
  const existing = readCookie(SESSION_COOKIE);
  const id = existing || randomId();
  // Re-write with refreshed expiry — gives us a sliding-window session.
  writeCookie(SESSION_COOKIE, id, SESSION_TTL_MIN);
  return id;
}

function randomId(): string {
  // Avoid crypto.randomUUID() to keep older browsers happy; the
  // collision probability for 16 hex chars is negligible for our
  // visitor-count scale.
  const a = Math.random().toString(36).slice(2, 10);
  const b = Math.random().toString(36).slice(2, 10);
  return `${a}${b}${Date.now().toString(36)}`;
}

// ── UTMs ───────────────────────────────────────────────────────────

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

function captureUtmsFromUrl(): UtmTags | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const tags: UtmTags = {};
  let any = false;
  for (const key of UTM_KEYS) {
    const v = params.get(`utm_${key}`);
    if (v && v.length > 0) {
      tags[key] = v.slice(0, 200);
      any = true;
    }
  }
  if (!any) return null;
  // Persist for later events + form attribution.
  writeCookie(UTM_COOKIE, JSON.stringify(tags), UTM_TTL_DAYS * 24 * 60);
  return tags;
}

function readUtmCookie(): UtmTags | undefined {
  const raw = readCookie(UTM_COOKIE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as UtmTags;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

// ── Ad-click ids ───────────────────────────────────────────────────

/**
 * Persist this landing's click ids. A network on the URL replaces what the
 * cookie held for it (a new ad click is the one that counts); networks the
 * URL doesn't mention keep their earlier click. No click ids on the URL
 * leaves the cookie alone.
 */
function captureClickIdsFromUrl() {
  if (typeof window === 'undefined') return;
  const fromUrl = clickIdsFromSearch(window.location.search);
  if (Object.keys(fromUrl).length === 0) return;
  const merged = mergeClickIds(fromUrl, readLpClickCookie());
  writeCookie(LP_CLICK_COOKIE, JSON.stringify(merged), LP_CLICK_TTL_DAYS * 24 * 60);
}

// ── Scroll depth ───────────────────────────────────────────────────

function computeScrollDepthPct(): number {
  const doc = document.documentElement;
  const body = document.body;
  const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
  const viewport = window.innerHeight || doc.clientHeight || 0;
  const scrollHeight = Math.max(
    doc.scrollHeight || 0,
    body.scrollHeight || 0,
    doc.offsetHeight || 0,
    body.offsetHeight || 0,
  );
  // Bottom-of-viewport position vs total scroll height.
  const reached = scrollTop + viewport;
  if (scrollHeight <= viewport) return 100; // page fits in viewport
  return Math.min(100, Math.max(0, Math.round((reached / scrollHeight) * 100)));
}
