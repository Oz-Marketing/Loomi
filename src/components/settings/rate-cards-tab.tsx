'use client';

/**
 * Rate Cards — one markup per billing category.
 *
 * Until this existed the agency had ONE markup and it was Digital's, so every
 * radio buy, swag order and print run costed out at a 23% margin. Each category
 * now carries its own rate, and a channel picks up the rate of the category
 * it belongs to (see `BILLING_CATEGORIES` in lib/budget/channels).
 *
 * Entered as a MARGIN percentage, not a factor. The stored value is the
 * gross→spend factor (0.77), but nobody says "point seven seven" out loud —
 * they say "23 points". Typing the number you say and seeing the factor you
 * store is less error-prone than the reverse, and inverting the two is the
 * single most likely mistake on this page.
 *
 * Saves per row. These are five-second edits and a whole-table save makes one
 * typo roll back the rows that were right.
 */
import { useEffect, useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import {
  BILLING_CATEGORIES,
  BUDGET_CHANNELS,
  channelsWithoutBilling,
} from '@/lib/budget/channels';

export function RateCardsTab() {
  const [markups, setMarkups] = useState<Record<string, number> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing-markups')
      .then((r) => r.json())
      .then((d) => {
        setMarkups(d.markups);
        setDrafts(
          Object.fromEntries(
            Object.entries(d.markups as Record<string, number>).map(([k, v]) => [
              k,
              marginOf(v),
            ]),
          ),
        );
      })
      .catch(() => toast.error('Failed to load rate cards'));
  }, []);

  async function save(category: string, label: string) {
    const margin = Number(drafts[category]);
    if (!Number.isFinite(margin) || margin <= 0 || margin >= 100) {
      toast.error('Enter a margin between 0 and 100.');
      return;
    }
    const factor = round4(1 - margin / 100);
    setSaving(category);
    try {
      const res = await fetch('/api/billing-markups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, markup: factor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save that rate');
        return;
      }
      setMarkups((m) => ({ ...(m ?? {}), [category]: factor }));
      setJustSaved(category);
      setTimeout(() => setJustSaved((c) => (c === category ? null : c)), 2000);
      toast.success(`${label} saved`);
    } catch {
      toast.error('Could not save that rate');
    } finally {
      setSaving(null);
    }
  }

  if (!markups) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading rate cards…</p>
      </div>
    );
  }

  const unassigned = channelsWithoutBilling();

  return (
    <div className="max-w-3xl space-y-4">
      <section className="glass-section-card rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Rate Cards</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
          What the agency keeps on each kind of work. A budget line picks up the rate of the
          category its channel belongs to, and the rate is <strong>frozen onto the line</strong> when
          it&rsquo;s created — changing a rate here never rewrites money already committed.
        </p>

        <div className="mt-5 space-y-2">
          {BILLING_CATEGORIES.map((cat) => {
            const stored = markups[cat.key] ?? cat.defaultMarkup;
            const draft = drafts[cat.key] ?? '';
            const margin = Number(draft);
            const valid = Number.isFinite(margin) && margin > 0 && margin < 100;
            const dirty = valid && round4(1 - margin / 100) !== round4(stored);
            const channels = BUDGET_CHANNELS.filter((c) => c.billing === cat.key);

            return (
              <div
                key={cat.key}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3"
              >
                <div className="min-w-[150px] flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)]">{cat.label}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
                    {channels.length > 0
                      ? channels.map((c) => c.label).join(', ')
                      : 'No channels yet'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^\d*\.?\d*$/.test(v)) {
                        setDrafts((d) => ({ ...d, [cat.key]: v }));
                      }
                    }}
                    className="w-[72px] rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--muted-foreground)]">% margin</span>
                </div>

                {/* The stored factor, shown because it's what the ledger holds
                    and what every line's markup will read as. */}
                <span className="w-[104px] text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                  {valid ? `× ${round4(1 - margin / 100)} cost` : '—'}
                </span>

                <button
                  type="button"
                  disabled={!dirty || saving === cat.key}
                  onClick={() => void save(cat.key, cat.label)}
                  className={`w-[74px] rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    justSaved === cat.key
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : 'bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-30'
                  }`}
                >
                  {justSaved === cat.key ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckIcon className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  ) : saving === cat.key ? (
                    'Saving…'
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Channels with no rate card. Listed rather than hidden: they quietly
          fall back to the agency default, which is the exact one-size-fits-all
          behaviour rate cards exist to replace, so the gap should be visible. */}
      {unassigned.length > 0 && (
        <section className="glass-section-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Channels with no rate card
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            These {unassigned.length} fall back to the account&rsquo;s own rate, then the agency
            default. That&rsquo;s unchanged from before rate cards existed, so nothing is broken —
            but a rate that says &ldquo;Digital&rdquo; is being applied to work that isn&rsquo;t.
            Tell a developer which category each belongs to and they become one line of config.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {unassigned.map((c) => (
              <span
                key={c.key}
                className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-1 text-[11px] text-[var(--muted-foreground)]"
              >
                {c.label}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 0.77 → "23" for display. */
function marginOf(factor: number): string {
  return String(round4((1 - factor) * 100));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
