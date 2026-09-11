'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUturnLeftIcon,
  BellAlertIcon,
  ChevronDownIcon,
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
import { SECTOR_ICONS } from '@/components/icons/sector-icons';
import { Collapse } from '@/components/ui/collapse';
import { useAccount } from '@/contexts/account-context';
import type { ReactElement, SVGProps } from 'react';
import {
  NOTIFICATION_CATEGORY_STYLE,
  type NotificationCategory,
} from '@/lib/notifications/surfaces';

type SectorFilter = 'all' | 'studio' | 'reporting' | 'projects';

/**
 * Sector options wear the product's OWN sector marks (`SECTOR_ICONS`), not
 * heroicons — the same glyphs the surface switcher and the sector brand use, so
 * "Studio" here is the mark a person already recognises from the rail.
 */
const SECTOR_OPTIONS: {
  value: SectorFilter;
  label: string;
  Icon: ((props: SVGProps<SVGSVGElement>) => ReactElement) | null;
}[] = [
  { value: 'all', label: 'All', Icon: null },
  { value: 'studio', label: 'Studio', Icon: SECTOR_ICONS.studio },
  { value: 'reporting', label: 'Reporting', Icon: SECTOR_ICONS.reporting },
  // `SECTOR_ICONS` keys the Projects mark as `app`, its host, while the filter
  // speaks in sectors.
  { value: 'projects', label: 'Projects', Icon: SECTOR_ICONS.app },
];

/**
 * Sector picker — a custom menu, not a native `<select>`.
 *
 * A native control cannot carry the sector marks, and on the panel's dark frost
 * its option list is drawn by the OS in system chrome that ignores the theme.
 */
function SectorSelect({
  value,
  onChange,
}: {
  value: SectorFilter;
  onChange: (next: SectorFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = SECTOR_OPTIONS.find((o) => o.value === value) ?? SECTOR_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Showing: ${current.label}`}
        className="flex w-full items-center gap-1.5 rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 px-2 py-1.5 text-xs text-[var(--sidebar-foreground)] transition-colors hover:border-[var(--primary)]"
      >
        {current.Icon ? (
          <current.Icon className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <BellAlertIcon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-muted-foreground)]" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-muted-foreground)] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="panel-menu absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg animate-dropdown-in"
        >
          {SECTOR_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${
                o.value === value
                  ? 'font-semibold text-[var(--primary)]'
                  : 'text-[var(--foreground)]'
              }`}
            >
              {o.Icon ? (
                <o.Icon className="h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <BellAlertIcon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-muted-foreground)]" />
              )}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

/**
 * The account a notification is ABOUT, which is not the account you are
 * standing in. Almost every automated notification names one in `meta` — the
 * panel uses it to label the row and to switch scope on the way out.
 */
export function notificationAccountKey(item: { metaJson: string | null }): string | null {
  if (!item.metaJson) return null;
  try {
    const meta = JSON.parse(item.metaJson) as Record<string, unknown>;
    return typeof meta.accountKey === 'string' && meta.accountKey ? meta.accountKey : null;
  } catch {
    return null;
  }
}

/** A numeric field off `meta`, or null when it is absent or not a number. */
function metaCount(item: { metaJson: string | null }, field: string): number | null {
  if (!item.metaJson) return null;
  try {
    const meta = JSON.parse(item.metaJson) as Record<string, unknown>;
    const value = meta[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Which rows collapse together.
 *
 * The nightly Ad Generator run touches every enabled account, so one night's
 * work arrives as thirty-odd separate rows that say almost the same thing. They
 * are the SAME NEWS about DIFFERENT accounts, so they bundle by type and by
 * day — never across days, because "this morning" and "last Tuesday" are not
 * one thing to act on.
 */
export function notificationGroupKey(item: { type: string; createdAt: string }): string {
  return `${item.type}:${new Date(item.createdAt).toDateString()}`;
}

/** Below this a bundle is just a row wearing extra chrome. */
const GROUP_MIN = 3;

/**
 * The visible list, with pile-ups folded into bundles.
 *
 * A bundle sits where its NEWEST member would have sat, so the panel still
 * reads newest-first; everything that never piles up is left exactly as it was.
 */
export function groupNotifications<T extends { id: string; type: string; createdAt: string }>(
  items: T[],
): ({ kind: 'single'; key: string; item: T } | { kind: 'group'; key: string; items: T[] })[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = notificationGroupKey(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const rows: ({ kind: 'single'; key: string; item: T } | { kind: 'group'; key: string; items: T[] })[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    const key = notificationGroupKey(item);
    const bucket = buckets.get(key)!;
    if (bucket.length < GROUP_MIN) {
      rows.push({ kind: 'single', key: item.id, item });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    rows.push({ kind: 'group', key, items: bucket });
  }
  return rows;
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

interface RowActions {
  /** Mark read (if unread), take the row's account with you, and — when the
   *  row actually links somewhere — close the panel behind you. */
  onOpen: (item: ApiNotification, navigating: boolean) => void;
  onToggleRead: (id: string, currentlyUnread: boolean) => void;
  onDelete: (id: string, wasUnread: boolean) => void;
}

/**
 * Per-row actions. Revealed on hover so a quiet list stays quiet, but always
 * present for keyboard users.
 *
 * `focus-within` keeps these reachable by keyboard, but a MOUSE click also
 * leaves the button focused — so after marking a row read/unread the icons
 * stayed pinned open until you clicked elsewhere. Each handler blurs itself,
 * which clears the pointer case without costing the keyboard one.
 */
function RowActions({
  unread,
  onRead,
  onDismiss,
  readLabel,
  dismissLabel,
}: {
  unread: boolean;
  onRead: () => void;
  onDismiss: () => void;
  readLabel?: string;
  dismissLabel?: string;
}) {
  return (
    <span className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        aria-label={readLabel ?? (unread ? 'Mark as read' : 'Mark as unread')}
        title={readLabel ?? (unread ? 'Mark as read' : 'Mark as unread')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
          onRead();
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
        aria-label={dismissLabel ?? 'Dismiss'}
        title={dismissLabel ?? 'Dismiss'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
          onDismiss();
        }}
        className="rounded-md p-1 text-[var(--sidebar-muted-foreground)] transition-colors hover:bg-[var(--sidebar-muted)] hover:text-red-400"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * One notification.
 *
 * `showCategory` is off inside a bundle — the bundle's header already says
 * which part of the product is talking, and repeating it on every child turns
 * the expanded list into a wall of identical chips. The ACCOUNT chip stays,
 * because inside a bundle it is the only thing telling the rows apart.
 */
function NotificationRow({
  item,
  accountName,
  showCategory,
  actions,
}: {
  item: ApiNotification;
  accountName: string | null;
  showCategory: boolean;
  actions: RowActions;
}) {
  const unread = !item.readAt;
  const style = item.category ? NOTIFICATION_CATEGORY_STYLE[item.category] : null;
  const Icon = style ? CATEGORY_ICON[style.icon] : BellAlertIcon;
  const href = resolveNotificationHref(item);
  const alarming = item.severity !== 'info';

  const inner = (
    <div
      className={`group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors ${
        // Unread wears a wash of the app's primary, not grey — grey reads as
        // "disabled" next to a read row, which is the opposite of what an
        // unread item is saying.
        unread
          ? 'bg-[var(--primary)]/10 hover:bg-[var(--primary)]/[0.16]'
          : 'hover:bg-[var(--sidebar-muted)]/50'
      } ${href ? 'cursor-pointer' : ''}`}
    >
      {/* The category tile is the row's identity — one glance says which part
          of the product is talking. Inside a bundle the header carries it, so
          the children indent under a plain dot instead. */}
      {showCategory ? (
        <span
          className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
            style?.tint ?? 'bg-[var(--muted)]'
          }`}
        >
          <Icon className={`h-4 w-4 ${style?.accent ?? 'text-[var(--muted-foreground)]'}`} />
        </span>
      ) : (
        <span className="mt-2 flex h-1.5 w-1.5 flex-shrink-0 items-center justify-center">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              unread ? 'bg-[var(--primary)]' : 'bg-[var(--sidebar-muted-foreground)]/40'
            }`}
          />
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* Severity colours the TITLE, not a rail down the side. The rail put a
            stripe on every row and turned the panel into one undifferentiated
            column; the words are what someone reads, so that is where "this
            needs attention" belongs. */}
        <p
          className={`pr-10 text-xs leading-snug ${
            SEVERITY_TITLE[item.severity] ||
            (unread ? 'text-[var(--sidebar-foreground)]' : 'text-[var(--sidebar-foreground)]/75')
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
          {/* The real page name, not an abbreviation — the chip's job is
              telling you exactly where this came from. */}
          {showCategory && item.category && style && (
            <span
              title={item.typeLabel ?? undefined}
              className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${style.tint} ${style.accent}`}
            >
              {item.category}
            </span>
          )}
          {/* WHOSE. Without it every automated row reads as generic product
              chatter, and clicking is the only way to find out which account
              is being talked about. */}
          {accountName && (
            <span
              title={accountName}
              className="max-w-[10rem] truncate rounded bg-[var(--sidebar-muted)] px-1.5 py-0.5 font-medium text-[var(--sidebar-foreground)]/80"
            >
              {accountName}
            </span>
          )}
          {/* Product news is Loomi talking about itself; a tool notification is
              your account needing something. */}
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

      <RowActions
        unread={unread}
        onRead={() => actions.onToggleRead(item.id, unread)}
        onDismiss={() => actions.onDelete(item.id, unread)}
      />
      {unread && (
        <span className="absolute right-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[var(--primary)] transition-opacity group-hover:opacity-0" />
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} onClick={() => actions.onOpen(item, true)} className="block">
        {inner}
      </Link>
    );
  }
  return <div onClick={() => actions.onOpen(item, false)}>{inner}</div>;
}

/**
 * A night's worth of the same news, folded into one row.
 *
 * Collapsed it answers the only two questions a pile-up raises — what happened
 * and to how many accounts — and its read/dismiss act on the whole bundle, so
 * clearing one night is one click instead of thirty. Expanded it is the same
 * rows as before, each still linking to its own account.
 */
function NotificationGroup({
  items,
  accountNameFor,
  actions,
  onBulkRead,
  onBulkDelete,
}: {
  items: ApiNotification[];
  accountNameFor: (item: ApiNotification) => string | null;
  actions: RowActions;
  onBulkRead: (ids: string[], markUnread: boolean) => void;
  onBulkDelete: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const first = items[0];
  const style = first.category ? NOTIFICATION_CATEGORY_STYLE[first.category] : null;
  const Icon = style ? CATEGORY_ICON[style.icon] : BellAlertIcon;
  const unread = items.filter((i) => !i.readAt).length;
  const severity = items.some((i) => i.severity === 'critical')
    ? 'critical'
    : items.some((i) => i.severity === 'warning')
      ? 'warning'
      : 'info';

  const names = Array.from(
    new Set(items.map((i) => accountNameFor(i)).filter((n): n is string => Boolean(n))),
  );
  // Only when EVERY member carries the same counter — `count` (ads built) and
  // `offers` (offers covered) are different units, and a sum across a mix would
  // be a number that means nothing.
  const counts = items.map((i) => metaCount(i, 'count'));
  const total = counts.every((c) => c !== null) ? counts.reduce((a, c) => a + (c ?? 0), 0) : null;

  // One account gets NAMED — "1 account" is a worse answer than the account
  // itself, and a bundle of repeat runs on a single rooftop is common.
  const spread =
    names.length === 1
      ? `for ${names[0]}`
      : names.length > 1
        ? `across ${names.length} accounts`
        : `in ${items.length} updates`;
  const headline =
    total !== null && total > 0
      ? `${first.typeLabel ?? first.title} — ${total} ${spread}`
      : `${first.typeLabel ?? first.title} — ${spread.replace(/^(for|across|in) /, '')}`;
  const subject =
    names.length > 1
      ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''}`
      : `${items.length} update${items.length === 1 ? '' : 's'}`;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--sidebar-border-soft)]/50">
      <div
        className={`group relative flex items-start transition-colors ${
          unread
            ? 'bg-[var(--primary)]/10 hover:bg-[var(--primary)]/[0.16]'
            : 'bg-[var(--sidebar-muted)]/40 hover:bg-[var(--sidebar-muted)]/70'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2.5 text-left"
        >
          <span
            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
              style?.tint ?? 'bg-[var(--muted)]'
            }`}
          >
            <Icon className={`h-4 w-4 ${style?.accent ?? 'text-[var(--muted-foreground)]'}`} />
          </span>

          <div className="min-w-0 flex-1">
            <p
              className={`pr-16 text-xs leading-snug ${
                SEVERITY_TITLE[severity] ||
                (unread ? 'text-[var(--sidebar-foreground)]' : 'text-[var(--sidebar-foreground)]/75')
              } ${unread ? 'font-semibold' : ''}`}
            >
              {headline}
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-snug text-[var(--sidebar-muted-foreground)]">
              {subject}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-[var(--sidebar-muted-foreground)]">
              {first.category && style && (
                <span
                  className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${style.tint} ${style.accent}`}
                >
                  {first.category}
                </span>
              )}
              {unread > 0 && <span>{unread} unread</span>}
              <span>·</span>
              <span className="whitespace-nowrap">{formatRelative(first.createdAt)}</span>
              <ChevronDownIcon
                className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
          </div>
        </button>

        <RowActions
          unread={unread > 0}
          readLabel={unread > 0 ? 'Mark all in this group read' : 'Mark all in this group unread'}
          dismissLabel="Dismiss all in this group"
          onRead={() =>
            onBulkRead(
              items.filter((i) => (unread > 0 ? !i.readAt : Boolean(i.readAt))).map((i) => i.id),
              unread === 0,
            )
          }
          onDismiss={() => onBulkDelete(items.map((i) => i.id))}
        />
        {unread > 0 && (
          <span className="absolute right-2.5 top-3 h-1.5 w-1.5 rounded-full bg-[var(--primary)] transition-opacity group-hover:opacity-0" />
        )}
      </div>

      <Collapse open={open}>
        <div className="space-y-1 border-t border-[var(--sidebar-border-soft)]/50 p-1.5">
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              accountName={accountNameFor(item)}
              showCategory={false}
              actions={actions}
            />
          ))}
        </div>
      </Collapse>
    </div>
  );
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
   * Which SECTOR's notifications to show.
   *
   * Defaults to the sector you are standing in — on Studio, project chatter is
   * someone else's job today — but "All" is one click away, because the whole
   * point of a bell is being told about the thing you are not looking at.
   */
  const [sector, setSector] = useState<SectorFilter>('all');
  const surface = useCurrentSurface();
  const panelRef = useRef<HTMLDivElement>(null);
  const { accounts, accountsLoaded, setAccount } = useAccount();

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

  // Seed the sector filter from the surface once it resolves. Studio and
  // Reporting are separate sectors but the same host, so the hook can only get
  // us as far as "studio"; App means Projects.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || surface === null) return;
    seeded.current = true;
    setSector(surface === 'studio' ? 'studio' : surface === 'reporting' ? 'reporting' : 'projects');
  }, [surface]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (sector !== 'all' && i.category) {
        const owner = NOTIFICATION_CATEGORY_STYLE[i.category]?.sector ?? null;
        // `null` is product news — it belongs to no sector and shows under
        // every filter rather than being hidden by all of them.
        if (owner !== null && owner !== sector) return false;
      }
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        (i.body ?? '').toLowerCase().includes(q) ||
        (i.typeLabel ?? '').toLowerCase().includes(q) ||
        (i.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, sector]);

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

  /** Read/unread for a whole bundle, in one round trip instead of thirty. */
  const handleBulkRead = async (ids: string[], markUnread: boolean) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    const readAt = markUnread ? null : new Date().toISOString();
    setItems((prev) => prev.map((i) => (gone.has(i.id) ? { ...i, readAt } : i)));
    onChange?.(
      markUnread ? unreadCount + ids.length : Math.max(0, unreadCount - ids.length),
    );
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, unread: markUnread }),
      });
    } catch {
      /* the optimistic flip stands; the next load reconciles */
    }
  };

  /** Dismiss a whole bundle. Optimistic, for the same reason one row is. */
  const handleBulkDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    const unreadGone = items.filter((i) => gone.has(i.id) && !i.readAt).length;
    setItems((prev) => prev.filter((i) => !gone.has(i.id)));
    if (unreadGone > 0) onChange?.(Math.max(0, unreadCount - unreadGone));
    try {
      await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      /* the rows are already gone locally; the next load reconciles */
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

  /**
   * The account a row is about, named the way the switcher names it.
   *
   * Held back until the account list lands — flashing the raw key and swapping
   * it for the dealer name a beat later is worse than showing nothing.
   */
  const accountNameFor = (item: ApiNotification): string | null => {
    const key = notificationAccountKey(item);
    if (!key || !accountsLoaded) return null;
    return accounts[key]?.dealer ?? key;
  };

  const rowActions: RowActions = {
    onOpen: (item, navigating) => {
      /**
       * TAKE THE ACCOUNT WITH YOU.
       *
       * `resolveNotificationHref` already puts `?account=<key>` on the link,
       * but the provider only reads that param when it MOUNTS — and a click
       * inside the app is a soft navigation, so it never re-runs. The result
       * was landing on the right page still scoped to the account you were
       * already standing in: told about Young Chevrolet, shown Young Nissan.
       * `setAccount` enforces the role's own account restrictions, so this
       * cannot widen anyone's reach.
       */
      const key = notificationAccountKey(item);
      if (key) setAccount({ mode: 'account', accountKey: key });
      void handleItemClick(item);
      if (navigating) onClose();
    },
    onToggleRead: (id, currentlyUnread) => void handleToggleRead(id, currentlyUnread),
    onDelete: (id, wasUnread) => void handleDelete(id, wasUnread),
  };

  const rows = groupNotifications(visible);

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

        {/* Search carries the row; the sector picker rides alongside it rather
            than taking a line of its own. */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="relative flex-1 min-w-0">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sidebar-muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="w-full rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 py-1.5 pl-8 pr-2 text-xs text-[var(--sidebar-foreground)] outline-none transition-colors placeholder:text-[var(--sidebar-muted-foreground)] focus:border-[var(--primary)]"
            />
          </div>
          <div className="w-[128px] flex-shrink-0">
            <SectorSelect value={sector} onChange={setSector} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sidebar-border-soft)] px-4 pb-3 pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={unreadOnly}
            onClick={() => setUnreadOnly((v) => !v)}
            className="inline-flex items-center gap-1.5"
          >
            {/* The knob is anchored with `left-0.5` and travels by exactly the
                rail's inner width minus its own — without an explicit left it
                started at the flow position and the "on" translate carried it
                off the end. */}
            <span
              className={`relative block h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
                unreadOnly ? 'bg-[var(--primary)]' : 'bg-[var(--sidebar-muted)]'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  unreadOnly ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </span>
            <span className="text-[11px] font-medium text-[var(--sidebar-foreground)]">Unread only</span>
          </button>
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
                  : sector !== 'all'
                    ? `Nothing in ${SECTOR_OPTIONS.find((o) => o.value === sector)?.label ?? 'that area'}.`
                    : 'No notifications yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((row) =>
                row.kind === 'group' ? (
                  <NotificationGroup
                    key={row.key}
                    items={row.items}
                    accountNameFor={accountNameFor}
                    actions={rowActions}
                    onBulkRead={handleBulkRead}
                    onBulkDelete={handleBulkDelete}
                  />
                ) : (
                  <NotificationRow
                    key={row.key}
                    item={row.item}
                    accountName={accountNameFor(row.item)}
                    showCategory
                    actions={rowActions}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
