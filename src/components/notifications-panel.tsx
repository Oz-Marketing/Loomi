'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUturnLeftIcon,
  BellAlertIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  BookOpenIcon,
  ChartBarIcon,
  CheckIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  MegaphoneIcon,
  PhotoIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';
import {
  NOTIFICATION_CATEGORY_STYLE,
  NOTIFICATION_CATEGORY_SURFACE,
  type NotificationCategory,
} from '@/lib/notifications/surfaces';

/** Icon keys in `surfaces.ts` → components. That file stays React-free so the
 *  server can import it too, so the mapping lives here. */
const CATEGORY_ICON = {
  megaphone: MegaphoneIcon,
  chart: ChartBarIcon,
  clipboard: ClipboardDocumentListIcon,
  photo: PhotoIcon,
  book: BookOpenIcon,
  sparkles: SparklesIcon,
} as const;

interface ApiNotification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  link: string | null;
  metaJson: string | null;
  /** From the server registry — the client can't import it (prisma). */
  category: NotificationCategory | null;
  typeLabel: string | null;
  emailedAt: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Severity is now a MARKER, not the row's identity.
 *
 * Every row used to wear a severity-coloured left border, so an ordinary "ads
 * are ready" sat in the same blue stripe as everything else and the panel read
 * as one undifferentiated list. Identity comes from the CATEGORY now; severity
 * only speaks up when it has something to say.
 */
const SEVERITY_TITLE: Record<ApiNotification['severity'], string> = {
  info: '',
  warning: 'text-amber-500 dark:text-amber-400',
  critical: 'text-red-500 dark:text-red-400',
};

/**
 * Point the link at the thing the notification is ABOUT.
 *
 * The stored `link` is a page — `/ad-generator` — which drops you into whatever
 * account you last had open and leaves you to find the item. `meta` almost
 * always carries `accountKey`, and often the record's own id, so the panel can
 * do better than the page.
 *
 *  • `accountKey` scopes the destination, so the run you were told about is the
 *    one on screen.
 *  • `adId` / `creativeId` becomes `focus=<id>`, which the target list uses to
 *    scroll to that item and ring it.
 */
export function resolveNotificationHref(item: {
  link: string | null;
  metaJson: string | null;
}): string | null {
  if (!item.link) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = item.metaJson ? (JSON.parse(item.metaJson) as Record<string, unknown>) : {};
  } catch {
    return item.link;
  }

  const [path, existing] = item.link.split('?');
  const params = new URLSearchParams(existing ?? '');
  const accountKey = typeof meta.accountKey === 'string' ? meta.accountKey : null;
  if (accountKey && !params.has('account')) params.set('account', accountKey);

  const focus =
    (typeof meta.creativeId === 'string' && meta.creativeId) ||
    (typeof meta.adId === 'string' && meta.adId) ||
    null;
  if (focus && !params.has('focus')) params.set('focus', focus);

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(1, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NotificationsPanelProps {
  onClose: () => void;
  onChange?: (unread: number) => void;
}

export function NotificationsPanel({ onClose, onChange }: NotificationsPanelProps) {
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  /**
   * Which surface's notifications to show.
   *
   * Defaults to the one you are standing in: on Studio, Projects and pacing
   * chatter is someone else's job today. "Everything" is one click away because
   * the whole point of a bell is that you can be told about the thing you are
   * not currently looking at.
   */
  const [scope, setScope] = useState<'here' | 'all' | 'other'>('here');
  const surface = useCurrentSurface();
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?limit=50${unreadOnly ? '&unreadOnly=1' : ''}`);
      if (!res.ok) return;
      const data = (await res.json()) as { items: ApiNotification[]; unreadCount: number };
      setItems(data.items);
      onChange?.(data.unreadCount);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [unreadOnly, onChange]);

  useEffect(() => {
    load();
  }, [load]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

  /** Studio and Reporting are one bucket for this purpose — both are Studio-host
   *  surfaces, and `NOTIFICATION_CATEGORY_SURFACE` only distinguishes studio/app. */
  const here: 'studio' | 'app' | null = surface === null ? null : surface === 'studio' ? 'studio' : 'app';

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (here && scope !== 'all' && i.category) {
        const owner: 'studio' | 'app' | 'both' = NOTIFICATION_CATEGORY_SURFACE[i.category] ?? 'app';
        // `both` (product news) belongs on every surface, so it is never
        // "somewhere else" and stays visible in all three scopes.
        if (owner !== 'both') {
          const mine = owner === here;
          if (scope === 'here' && !mine) return false;
          if (scope === 'other' && mine) return false;
        } else if (scope === 'other') {
          return false;
        }
      }
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        (i.body ?? '').toLowerCase().includes(q) ||
        (i.typeLabel ?? '').toLowerCase().includes(q) ||
        (i.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, scope, here]);

  /** Dismiss one. Optimistic — the row is gone before the round trip, because a
   *  dismiss that pauses reads as a click that did not land. */
  const handleDelete = async (id: string, wasUnread: boolean) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (wasUnread) onChange?.(Math.max(0, unreadCount - 1));
    try {
      await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      /* the row is already gone locally; the next load reconciles */
    }
  };

  /** Flip one row's read state, either direction. */
  const handleToggleRead = async (id: string, currentlyUnread: boolean) => {
    const readAt = currentlyUnread ? new Date().toISOString() : null;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt } : i)));
    onChange?.(currentlyUnread ? Math.max(0, unreadCount - 1) : unreadCount + 1);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], unread: !currentlyUnread }),
      });
    } catch {
      /* the optimistic flip stands; the next load reconciles */
    }
  };

  const handleItemClick = async (item: ApiNotification) => {
    if (!item.readAt) {
      // Optimistic update
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
      );
      onChange?.(Math.max(0, unreadCount - 1));
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [item.id] }),
        });
      } catch {
        /* ignore */
      }
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: new Date().toISOString() })));
    onChange?.(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 animate-overlay-in" onClick={onClose}>
      <div
        ref={panelRef}
        // frost-heavy, not glass-panel: the panel sits over dense page content
        // (tables, budget cards) with no scrim, and the lighter glass let it all
        // read through. Same treatment as the notes / budget-log drawers.
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[420px] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellAlertIcon className="w-5 h-5 text-black dark:text-[var(--primary)]" />
            <h3 className="text-sm font-bold tracking-tight">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-[var(--primary)] text-[var(--primary-foreground)]">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Link
              href="/settings/notifications"
              onClick={onClose}
              aria-label="Notification settings"
              title="Notification settings"
              className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
            >
              <Cog6ToothIcon className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
              aria-label="Close"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search first: with a few dozen rows, finding the one you half
            remember beats any amount of filtering. */}
        <div className="px-4 pt-3">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sidebar-muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="w-full rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 py-1.5 pl-8 pr-2 text-xs text-[var(--sidebar-foreground)] outline-none transition-colors placeholder:text-[var(--sidebar-muted-foreground)] focus:border-[var(--primary)]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-2.5">
          <div className="flex items-center gap-2">
            {/* A switch, not two tabs: "unread only" is one boolean, and a pair
                of tabs implied two equal views of the same list. */}
            <button
              type="button"
              role="switch"
              aria-checked={unreadOnly}
              onClick={() => setUnreadOnly((v) => !v)}
              className="inline-flex items-center gap-1.5"
            >
              <span
                className={`relative h-4 w-7 rounded-full transition-colors ${
                  unreadOnly ? 'bg-[var(--primary)]' : 'bg-[var(--sidebar-muted)]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    unreadOnly ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="text-[11px] font-medium text-[var(--sidebar-foreground)]">Unread only</span>
            </button>
          </div>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sidebar-muted-foreground)] transition-colors hover:text-[var(--sidebar-foreground)] disabled:opacity-50"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Mark all read
          </button>
        </div>

        {/* Sector scope. Hidden when we cannot tell which surface we are on,
            because a filter that might be lying is worse than none. */}
        {here && (
          <div className="flex items-center gap-1 px-4 pb-2.5">
            {([
              { key: 'here' as const, label: here === 'studio' ? 'Studio' : 'App' },
              { key: 'all' as const, label: 'Everything' },
              { key: 'other' as const, label: 'Other sectors' },
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  scope === opt.key
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--sidebar-muted)]/60 text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <div className="themed-scrollbar flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="text-[11px] text-[var(--sidebar-muted-foreground)] text-center py-8">
              Loading…
            </p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-[var(--sidebar-muted-foreground)]">
              {search.trim()
                ? `Nothing matches "${search.trim()}".`
                : unreadOnly
                  ? 'No unread notifications.'
                  : scope === 'other'
                    ? 'Nothing from other sectors.'
                    : 'No notifications yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((item) => {
                const unread = !item.readAt;
                const style = item.category ? NOTIFICATION_CATEGORY_STYLE[item.category] : null;
                const Icon = style ? CATEGORY_ICON[style.icon] : BellAlertIcon;
                const href = resolveNotificationHref(item);
                const alarming = item.severity !== 'info';

                const inner = (
                  <div
                    className={`group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors ${
                      unread
                        ? 'bg-[var(--sidebar-muted)]/60 hover:bg-[var(--sidebar-muted)]'
                        : 'hover:bg-[var(--sidebar-muted)]/50'
                    } ${href ? 'cursor-pointer' : ''}`}
                  >
                    {/* The category tile is the row's identity — one glance says
                        which part of the product is talking. */}
                    <span
                      className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                        style?.tint ?? 'bg-[var(--muted)]'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${style?.accent ?? 'text-[var(--muted-foreground)]'}`} />
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Severity colours the TITLE, not a rail down the side.
                          The rail put a stripe on every row and turned the
                          panel into one undifferentiated column; the words are
                          what someone reads, so that is where "this needs
                          attention" belongs. */}
                      <p
                        className={`pr-10 text-xs leading-snug ${
                          SEVERITY_TITLE[item.severity] ||
                          (unread
                            ? 'text-[var(--sidebar-foreground)]'
                            : 'text-[var(--sidebar-foreground)]/75')
                        } ${unread ? 'font-semibold' : ''}`}
                      >
                        {item.title}
                      </p>
                      {item.body && (
                        <p className="mt-0.5 text-[11px] leading-snug text-[var(--sidebar-muted-foreground)]">
                          {item.body}
                        </p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-[var(--sidebar-muted-foreground)]">
                        {style && (
                          <span
                            title={item.typeLabel ?? undefined}
                            className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${style.tint} ${style.accent}`}
                          >
                            {style.short}
                          </span>
                        )}
                        {/* Product news is Loomi talking about itself; a tool
                            notification is your account needing something. */}
                        {style?.kind === 'product' && <span>Announcement</span>}
                        {alarming && (
                          <ExclamationTriangleIcon
                            className={`h-3 w-3 ${
                              item.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                            }`}
                          />
                        )}
                        <span>·</span>
                        <span className="whitespace-nowrap">{formatRelative(item.createdAt)}</span>
                      </div>
                    </div>

                    {/* Per-row actions. Revealed on hover so a quiet list stays
                        quiet, but always present for keyboard users. Both stop
                        propagation — the row itself navigates. */}
                    <span className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label={unread ? 'Mark as read' : 'Mark as unread'}
                        title={unread ? 'Mark as read' : 'Mark as unread'}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleToggleRead(item.id, unread);
                        }}
                        className="rounded-md p-1 text-[var(--sidebar-muted-foreground)] transition-colors hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]"
                      >
                        {unread ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss"
                        title="Dismiss"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleDelete(item.id, unread);
                        }}
                        className="rounded-md p-1 text-[var(--sidebar-muted-foreground)] transition-colors hover:bg-[var(--sidebar-muted)] hover:text-red-400"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    {unread && (
                      <span className="absolute right-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[var(--primary)] transition-opacity group-hover:opacity-0" />
                    )}
                  </div>
                );

                if (href) {
                  return (
                    <Link
                      key={item.id}
                      href={href}
                      onClick={() => {
                        handleItemClick(item);
                        onClose();
                      }}
                      className="block"
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <div key={item.id} onClick={() => handleItemClick(item)}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
