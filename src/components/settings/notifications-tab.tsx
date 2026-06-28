'use client';

import { useEffect, useMemo, useState } from 'react';
import { BoltIcon, ClockIcon, BellSlashIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';
import { NOTIFICATION_CATEGORY_SURFACE, type NotificationCategory } from '@/lib/notifications/surfaces';

interface PreferenceItem {
  type: string;
  label: string;
  description: string;
  category: string;
  channel: 'digest' | 'immediate';
  defaultEnabled: boolean;
  enabled: boolean;
}

/** Map a category to its surface; unknown categories default to App so a new
 *  category is never silently hidden everywhere. */
function categorySurface(category: string): 'studio' | 'app' {
  return NOTIFICATION_CATEGORY_SURFACE[category as NotificationCategory] ?? 'app';
}

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

export function NotificationsTab() {
  const [items, setItems] = useState<PreferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

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

  const updateOne = async (type: string, enabled: boolean) => {
    // Optimistic UI
    const previous = items;
    setItems((prev) => prev.map((i) => (i.type === type ? { ...i, enabled } : i)));
    setSaving(type);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [{ type, enabled }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast.error('Could not save preference — reverting');
      setItems(previous);
    } finally {
      setSaving(null);
    }
  };

  const setAll = async (enabled: boolean, targets: PreferenceItem[]) => {
    if (targets.length === 0) return;
    const previous = items;
    const targetTypes = new Set(targets.map((t) => t.type));
    setItems((prev) => prev.map((i) => (targetTypes.has(i.type) ? { ...i, enabled } : i)));
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: targets.map((i) => ({ type: i.type, enabled })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(enabled ? 'Notifications enabled' : 'Notifications disabled');
    } catch {
      toast.error('Could not save preferences — reverting');
      setItems(previous);
    }
  };

  // Only this surface's notification categories (Studio vs App).
  const surfaceItems = useMemo(() => {
    if (effSurface === null) return [];
    return items.filter((i) => categorySurface(i.category) === effSurface);
  }, [items, effSurface]);

  // Group the surface's items by category — each becomes a tab.
  const byCategory = useMemo(() => {
    return surfaceItems.reduce<Record<string, PreferenceItem[]>>((acc, item) => {
      (acc[item.category] ??= []).push(item);
      return acc;
    }, {});
  }, [surfaceItems]);
  const categories = Object.keys(byCategory);

  // Keep the active tab valid as data loads / surface resolves.
  useEffect(() => {
    if (categories.length > 0 && (activeCat === null || !categories.includes(activeCat))) {
      setActiveCat(categories[0]);
    }
  }, [categories, activeCat]);

  const activeItems = activeCat ? byCategory[activeCat] ?? [] : [];
  const activeEnabled = activeItems.filter((i) => i.enabled).length;

  // Surface unknown (pre-hydration) or still fetching → loading.
  if (loading || effSurface === null) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading preferences…</p>;
  }

  if (surfaceItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
        <BellSlashIcon className="mb-3 h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="text-sm font-medium text-[var(--foreground)]">No notification settings here</p>
        <p className="mt-1 max-w-sm text-xs text-[var(--muted-foreground)]">
          {effSurface === 'studio'
            ? 'Studio doesn’t have configurable notifications yet. Project and Ad-Pacer alerts live in the Projects app.'
            : 'No notification types are registered for your account yet.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs text-[var(--muted-foreground)]">
        Choose which alerts you receive in-app and by email. Defaults are on.
      </p>

      {/* Category tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)]">
        {categories.map((cat) => {
          const isActive = cat === activeCat;
          const on = byCategory[cat].filter((i) => i.enabled).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCat(cat)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {cat}
              <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {on}/{byCategory[cat].length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active category */}
      <div className="mt-5 max-w-3xl">
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {activeEnabled} of {activeItems.length} on
          </span>
          <button
            type="button"
            onClick={() => setAll(true, activeItems)}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Enable all
          </button>
          <button
            type="button"
            onClick={() => setAll(false, activeItems)}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Disable all
          </button>
        </div>

        <div className="space-y-3">
          {activeItems.map((item) => (
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
              <ToggleSwitch
                checked={item.enabled}
                onChange={(next) => updateOne(item.type, next)}
                disabled={saving === item.type}
              />
            </div>
          ))}
        </div>

        <p className="mt-6 text-[11px] text-[var(--muted-foreground)]">
          In-app notifications appear in the bell-icon panel in the top-right.
          Immediate alerts also email you in real time. Daily-digest alerts are
          bundled into a single 8am email and continue to show in the bell panel.
        </p>
      </div>
    </div>
  );
}
