'use client';

import { useEffect, useMemo, useState } from 'react';
import { BoltIcon, ClockIcon, BellSlashIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';
import {
  NOTIFICATION_CATEGORY_STYLE,
  NOTIFICATION_CATEGORY_SURFACE,
  type NotificationCategory,
} from '@/lib/notifications/surfaces';
import { SECTOR_ICONS } from '@/components/icons/sector-icons';

interface PreferenceItem {
  type: string;
  label: string;
  description: string;
  category: string;
  channel: 'digest' | 'immediate';
  defaultEnabled: boolean;
  defaultEmailEnabled: boolean;
  /** In-app: shows in the bell panel. */
  enabled: boolean;
  /** Email: also lands in the inbox. Independent of `enabled`. */
  emailEnabled: boolean;
}

/** The two independently-togglable delivery channels. */
type Channel = 'enabled' | 'emailEnabled';

/** Map a category to its surface; unknown categories default to App so a new
 *  category is never silently hidden everywhere. */
function categorySurface(category: string): 'studio' | 'app' | 'both' {
  return NOTIFICATION_CATEGORY_SURFACE[category as NotificationCategory] ?? 'app';
}

/**
 * Which sector a category belongs to, for the every-sector view.
 *
 * Deliberately NOT `categorySurface`. That answers "which host shows the
 * toggle" — Projects and the ad pacer both live on the App host and would
 * collapse into one heading. A person reading a list of everything Loomi can
 * send them thinks in sectors, so this groups the way the bell panel filters.
 */
function categorySector(category: string): SectorKey {
  return NOTIFICATION_CATEGORY_STYLE[category as NotificationCategory]?.sector ?? 'shared';
}

type SectorKey = 'studio' | 'projects' | 'reporting' | 'shared';

/**
 * The every-sector view's tabs, in rail order, wearing the product's own sector
 * marks rather than generic glyphs.
 *
 * Three tabs, not one long page with headings. Stacked, the sectors ran to a
 * few screens of scrolling and the sector you actually came for was somewhere
 * in the middle; a strip puts each sector one click away and matches how the
 * rest of the app splits a settings screen.
 *
 * `shared` is not a tab. Product Updates is the only category no sector owns,
 * and it is reachable from every surface — a fourth tab called "Everywhere"
 * would hide it behind a click from all three places it belongs. It renders
 * under each tab instead, and because it is ONE preference, toggling it
 * anywhere changes it everywhere.
 */
const SECTOR_TABS: { key: Exclude<SectorKey, 'shared'>; label: string; Icon: typeof SECTOR_ICONS.studio }[] = [
  { key: 'studio', label: 'Studio', Icon: SECTOR_ICONS.studio },
  { key: 'reporting', label: 'Reporting', Icon: SECTOR_ICONS.reporting },
  // SECTOR_ICONS keys the Projects mark by its host, `app`.
  { key: 'projects', label: 'Projects', Icon: SECTOR_ICONS.app },
];

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

/**
 * `sector` — only the current sector's categories, which is what someone in
 * Studio settings wants to see. `all` — every category Loomi has, grouped by
 * sector, with one master switch over the lot.
 *
 * The every-sector view is what Agency Settings renders. Notification
 * preferences are per-USER and cross-sector, so answering "turn everything
 * off while I'm on leave" through the sector tabs meant visiting Studio
 * settings, then Projects settings, and still missing whatever lives on a
 * surface you rarely open.
 */
export function NotificationsTab({ scope = 'sector' }: { scope?: 'sector' | 'all' } = {}) {
  const [items, setItems] = useState<PreferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeSector, setActiveSector] = useState<Exclude<SectorKey, 'shared'>>('studio');

  const surface = useCurrentSurface();
  // Reporting is part of the App umbrella; treat it as 'app' for notifications.
  const effSurface: 'studio' | 'app' | null =
    surface === null ? null : surface === 'studio' ? 'studio' : 'app';

  useEffect(() => {
    fetch('/api/notifications/preferences')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: PreferenceItem[] }) => {
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        toast.error('Failed to load notification preferences');
      })
      .finally(() => setLoading(false));
  }, []);

  const updateOne = async (type: string, channel: Channel, value: boolean) => {
    // Optimistic UI
    const previous = items;
    setItems((prev) => prev.map((i) => (i.type === type ? { ...i, [channel]: value } : i)));
    setSaving(type);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [{ type, [channel]: value }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast.error('Could not save preference — reverting');
      setItems(previous);
    } finally {
      setSaving(null);
    }
  };

  const setAll = async (channel: Channel, value: boolean, targets: PreferenceItem[]) => {
    if (targets.length === 0) return;
    const previous = items;
    const targetTypes = new Set(targets.map((t) => t.type));
    setItems((prev) =>
      prev.map((i) => (targetTypes.has(i.type) ? { ...i, [channel]: value } : i)),
    );
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: targets.map((i) => ({ type: i.type, [channel]: value })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const noun = channel === 'emailEnabled' ? 'Emails' : 'In-app notifications';
      toast.success(value ? `${noun} enabled` : `${noun} disabled`);
    } catch {
      toast.error('Could not save preferences — reverting');
      setItems(previous);
    }
  };

  // Only this surface's notification categories, plus the `both` ones.
  //
  // `both` is exactly one category — Product Updates — and it stays everywhere
  // on purpose: the changelog panel is in the top bar on every surface, so the
  // opt-out has to be reachable from wherever you are when you decide you've
  // had enough. Every OTHER category is owned by one sector and shows only
  // there, which is what makes this list the current sector's.
  const surfaceItems = useMemo(() => {
    if (scope === 'all') return items;
    if (effSurface === null) return [];
    return items.filter((i) => {
      const s = categorySurface(i.category);
      return s === 'both' || s === effSurface;
    });
  }, [items, effSurface, scope]);

  // Group the surface's items by category — each becomes a section.
  const byCategory = useMemo(() => {
    return surfaceItems.reduce<Record<string, PreferenceItem[]>>((acc, item) => {
      (acc[item.category] ??= []).push(item);
      return acc;
    }, {});
  }, [surfaceItems]);
  const categories = Object.keys(byCategory);

  // The every-sector view's outline: one entry per tab, carrying that sector's
  // categories plus the sector-less ones. Tabs with nothing in them are kept
  // rather than dropped — a Reporting tab that vanishes reads as a bug, where
  // an empty one honestly says Reporting raises no notifications yet.
  const sectorTabs = useMemo(
    () =>
      SECTOR_TABS.map((tab) => ({
        ...tab,
        cats: categories.filter((cat) => {
          const owner = categorySector(cat);
          return owner === tab.key || owner === 'shared';
        }),
      })),
    [categories],
  );
  const activeSectorCats = sectorTabs.find((t) => t.key === activeSector)?.cats ?? [];

  // Keep the active tab valid as data loads / surface resolves.
  useEffect(() => {
    if (categories.length > 0 && (activeCat === null || !categories.includes(activeCat))) {
      setActiveCat(categories[0]);
    }
  }, [categories, activeCat]);


  // Every-sector view needs no surface, so it must not wait on hydration.
  if (loading || (scope === 'sector' && effSurface === null)) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading preferences…</p>;
  }

  if (surfaceItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
        <BellSlashIcon className="mb-3 h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="text-sm font-medium text-[var(--foreground)]">No notification settings here</p>
        <p className="mt-1 max-w-sm text-xs text-[var(--muted-foreground)]">
          {scope === 'all'
            ? 'No notification types are registered yet.'
            : effSurface === 'studio'
            ? 'Studio doesn’t have configurable notifications yet. Project and Ad-Pacer alerts live in the Projects app.'
            : 'No notification types are registered for your account yet.'}
        </p>
      </div>
    );
  }

  const allOn = surfaceItems.filter((i) => i.enabled).length;
  const allEmailed = surfaceItems.filter((i) => i.emailEnabled).length;

  const renderCategory = (cat: string) => {
          const catItems = byCategory[cat];
          const on = catItems.filter((i) => i.enabled).length;
          const emailed = catItems.filter((i) => i.emailEnabled).length;
          return (
            <section key={cat}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] pb-2">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{cat}</h3>
                <span className="mr-auto text-[11px] tabular-nums text-[var(--muted-foreground)]">
                  {on} of {catItems.length} in-app · {emailed} by email
                </span>
                {(
                  [
                    { channel: 'enabled', label: 'in-app' },
                    { channel: 'emailEnabled', label: 'email' },
                  ] as Array<{ channel: Channel; label: string }>
                ).map(({ channel, label }) => (
                  <span key={channel} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setAll(channel, true, catItems)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                    >
                      All {label}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAll(channel, false, catItems)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      aria-label={`Turn off all ${label} notifications in ${cat}`}
                    >
                      None
                    </button>
                  </span>
                ))}
              </div>

              <div className="space-y-3">
          {byCategory[cat].map((item) => (
                  <div
                    key={item.type}
                    className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">{item.label}</span>
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{
                            background:
                              item.channel === 'immediate'
                                ? 'rgba(56,189,248,0.18)'
                                : 'rgba(167,139,250,0.18)',
                            color: item.channel === 'immediate' ? '#7dd3fc' : '#c4b5fd',
                          }}
                          title={
                            item.channel === 'immediate'
                              ? 'Sent right away'
                              : 'Bundled into the daily 8am digest'
                          }
                        >
                          {item.channel === 'immediate' ? (
                            <BoltIcon className="h-3 w-3" />
                          ) : (
                            <ClockIcon className="h-3 w-3" />
                          )}
                          {item.channel === 'immediate' ? 'Immediate' : 'Daily digest'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{item.description}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-4">
                      {(
                        [
                          { channel: 'enabled', label: 'In-app', on: item.enabled },
                          { channel: 'emailEnabled', label: 'Email', on: item.emailEnabled },
                        ] as Array<{ channel: Channel; label: string; on: boolean }>
                      ).map(({ channel, label, on }) => (
                        <label key={channel} className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                            {label}
                          </span>
                          <ToggleSwitch
                            checked={on}
                            onChange={(next) => updateOne(item.type, channel, next)}
                            disabled={saving === item.type}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
  };

  return (
    <div>
      <p className="mb-4 text-xs text-[var(--muted-foreground)]">
        Choose how you receive each alert. <strong className="font-semibold">In-app</strong> shows
        it in the bell panel; <strong className="font-semibold">Email</strong> also sends it to your
        inbox. The two are independent — you can keep an alert in the panel without the email.
      </p>

      {/* The master switch, and the reason this view exists at all.
          Per-sector tabs can only answer "what does Studio send me". "Turn
          everything off while I'm on leave" needed three visits and still
          missed whatever lives on a surface you rarely open. */}
      {scope === 'all' && (
        <div className="mb-8 max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--foreground)]">All notifications</p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Applies to every category below, in every sector.{' '}
                <span className="tabular-nums">
                  {allOn} of {surfaceItems.length} in-app · {allEmailed} by email
                </span>
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-4">
              {(
                [
                  { channel: 'enabled', label: 'In-app', count: allOn },
                  { channel: 'emailEnabled', label: 'Email', count: allEmailed },
                ] as Array<{ channel: Channel; label: string; count: number }>
              ).map(({ channel, label, count }) => (
                <label key={channel} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    {label}
                  </span>
                  <ToggleSwitch
                    // Lit only when EVERY category is on. A partial state shown
                    // as "on" would make one tap look like it changed nothing.
                    checked={count === surfaceItems.length && surfaceItems.length > 0}
                    onChange={(next) => setAll(channel, next, surfaceItems)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* One section per category, no tab strip.
          The strip made you click through three collapsed lists to answer "am I
          getting emailed about this", and on a sector with two categories it was
          two tabs over four rows. Sections show everything at once. */}
      {scope === 'all' && (
        <div className="mb-6 flex max-w-3xl items-center gap-1 overflow-x-auto border-b border-[var(--border)]">
          {sectorTabs.map(({ key, label, Icon, cats }) => {
            const isActive = key === activeSector;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSector(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span className="tabular-nums opacity-60">{cats.length}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="max-w-3xl space-y-8">
        {scope === 'all'
          ? activeSectorCats.length > 0
            ? activeSectorCats.map(renderCategory)
            : (
              <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-xs text-[var(--muted-foreground)]">
                {SECTOR_TABS.find((t) => t.key === activeSector)?.label} doesn’t raise any
                notifications yet.
              </p>
            )
          : categories.map(renderCategory)}
      </div>

      <p className="mt-6 text-[11px] text-[var(--muted-foreground)]">
        In-app notifications appear in the bell-icon panel in the top-right. With Email on,
        immediate alerts are mailed in real time and daily-digest alerts are bundled into a single
        8am email. Turning In-app off stops both — there is nothing to email if the alert is never
        raised.
      </p>
    </div>
  );
}
