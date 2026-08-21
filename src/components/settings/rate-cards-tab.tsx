'use client';

/**
 * Rate Cards — the agency's billing categories and what it keeps on each.
 *
 * Until rate cards existed the agency had ONE markup and it was Digital's, so
 * every radio buy, swag order and print run costed out at a 23% margin. Until
 * THIS page could manage the list, the categories themselves were a constant in
 * lib/budget/channels — editable rates against a hardcoded taxonomy, which is
 * only agnostic if your agency happens to price work the way Oz Marketing does.
 * Both halves are now data (`BillingCategory`); the constant is just the seed.
 *
 * Rates are entered as a MARGIN percentage, not a factor. The stored value is
 * the gross→spend factor (0.77), but nobody says "point seven seven" out loud —
 * they say "23 points". Typing the number you say and seeing the factor you
 * store is less error-prone than the reverse, and inverting the two is the
 * single most likely mistake on this page.
 *
 * Saves per row. These are five-second edits and a whole-table save makes one
 * typo roll back the rows that were right.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';
import { useBudgetChannels } from '@/contexts/budget-channels-context';

type RateCard = {
  id: string;
  key: string;
  label: string;
  markup: number;
  sortOrder: number;
  archived: boolean;
};

export function RateCardsTab() {
  const { channels: ch } = useBudgetChannels();
  const [cards, setCards] = useState<RateCard[] | null>(null);
  /** Margin-percent drafts, keyed by card id. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newMargin, setNewMargin] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/rate-cards?archived=1');
      const data = await res.json();
      applyCards(data.rateCards as RateCard[]);
    } catch {
      toast.error('Failed to load rate cards');
    }
  }

  function applyCards(next: RateCard[]) {
    setCards(next);
    setDrafts(Object.fromEntries(next.map((c) => [c.id, marginOf(c.markup)])));
    setLabelDrafts(Object.fromEntries(next.map((c) => [c.id, c.label])));
  }

  /** Merge one server-returned card back in without disturbing other drafts. */
  function mergeCard(card: RateCard) {
    setCards((prev) => (prev ?? []).map((c) => (c.id === card.id ? card : c)));
    setDrafts((d) => ({ ...d, [card.id]: marginOf(card.markup) }));
    setLabelDrafts((l) => ({ ...l, [card.id]: card.label }));
  }

  async function patch(card: RateCard, body: Record<string, unknown>, note: string) {
    setBusy(card.id);
    try {
      const res = await fetch(`/api/rate-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save that rate card');
        return;
      }
      mergeCard(data.rateCard as RateCard);
      setJustSaved(card.id);
      setTimeout(() => setJustSaved((c) => (c === card.id ? null : c)), 2000);
      toast.success(note);
    } catch {
      toast.error('Could not save that rate card');
    } finally {
      setBusy(null);
    }
  }

  async function saveRow(card: RateCard) {
    const margin = Number(drafts[card.id]);
    const label = (labelDrafts[card.id] ?? '').trim();
    if (!label) {
      toast.error('A rate card needs a name.');
      return;
    }
    if (!Number.isFinite(margin) || margin <= 0 || margin >= 100) {
      toast.error('Enter a margin between 0 and 100.');
      return;
    }
    await patch(
      card,
      { label, markup: round4(1 - margin / 100) },
      `${label} saved`,
    );
  }

  async function create() {
    const margin = Number(newMargin);
    if (!newLabel.trim()) {
      toast.error('Give the rate card a name.');
      return;
    }
    if (!Number.isFinite(margin) || margin <= 0 || margin >= 100) {
      toast.error('Enter a margin between 0 and 100.');
      return;
    }
    setBusy('new');
    try {
      const res = await fetch('/api/rate-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), markup: round4(1 - margin / 100) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not create that rate card');
        return;
      }
      const card = data.rateCard as RateCard;
      setCards((prev) => [...(prev ?? []), card]);
      setDrafts((d) => ({ ...d, [card.id]: marginOf(card.markup) }));
      setLabelDrafts((l) => ({ ...l, [card.id]: card.label }));
      setNewLabel('');
      setNewMargin('');
      setAdding(false);
      toast.success(`${card.label} added`);
    } catch {
      toast.error('Could not create that rate card');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Move a card one place within the ACTIVE list and persist the whole order.
   * Up/down rather than drag-and-drop: seven rows reordered once a year doesn't
   * earn a drag layer, and buttons work on a phone and with a keyboard.
   */
  async function move(card: RateCard, delta: -1 | 1) {
    if (!cards) return;
    const list = cards.filter((c) => !c.archived);
    const i = list.findIndex((c) => c.id === card.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];

    // Optimistic: the row moves under the cursor, then the server confirms.
    const archived = cards.filter((c) => c.archived);
    setCards([...reordered, ...archived]);

    try {
      const res = await fetch('/api/rate-cards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...reordered, ...archived].map((c) => c.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save that order');
        void load();
        return;
      }
      setCards(data.rateCards as RateCard[]);
    } catch {
      toast.error('Could not save that order');
      void load();
    }
  }

  const active = useMemo(() => (cards ?? []).filter((c) => !c.archived), [cards]);
  const archived = useMemo(() => (cards ?? []).filter((c) => c.archived), [cards]);
  const unassigned = ch.withoutBilling();

  if (!cards) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading rate cards…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Rate Cards</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              What the agency keeps on each kind of work. A budget line picks up the rate of the
              category its channel bills at, and the rate is{' '}
              <strong>frozen onto the line</strong> when it&rsquo;s created — editing a card here
              never rewrites money already committed.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add card
            </button>
          )}
        </div>

        <div className="mt-5 space-y-2">
          {active.map((card, i) => {
            const draft = drafts[card.id] ?? '';
            const label = labelDrafts[card.id] ?? '';
            const margin = Number(draft);
            const validRate = Number.isFinite(margin) && margin > 0 && margin < 100;
            const dirty =
              label.trim() !== card.label ||
              (validRate && round4(1 - margin / 100) !== round4(card.markup));
            const channels = ch.active.filter((c) => c.billingKey === card.key);

            return (
              <div
                key={card.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-3"
              >
                <div className="flex flex-shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${card.label} up`}
                    disabled={i === 0}
                    onClick={() => void move(card, -1)}
                    className="rounded p-0.5 text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-20"
                  >
                    <ArrowUpIcon className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${card.label} down`}
                    disabled={i === active.length - 1}
                    onClick={() => void move(card, 1)}
                    className="rounded p-0.5 text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-20"
                  >
                    <ArrowDownIcon className="h-3 w-3" />
                  </button>
                </div>

                <div className="min-w-[150px] flex-1">
                  <input
                    value={label}
                    onChange={(e) =>
                      setLabelDrafts((l) => ({ ...l, [card.id]: e.target.value }))
                    }
                    aria-label={`${card.label} name`}
                    className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-[var(--foreground)] outline-none transition hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--input)]"
                  />
                  <p className="mt-0.5 truncate px-1.5 text-[11px] text-[var(--muted-foreground)]">
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
                    aria-label={`${card.label} margin`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^\d*\.?\d*$/.test(v)) {
                        setDrafts((d) => ({ ...d, [card.id]: v }));
                      }
                    }}
                    className="w-[68px] rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--muted-foreground)]">%</span>
                </div>

                {/* The stored factor, shown because it's what the ledger holds
                    and what every line's markup will read as. */}
                <span className="w-[92px] text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                  {validRate ? `× ${round4(1 - margin / 100)} cost` : '—'}
                </span>

                <button
                  type="button"
                  disabled={!dirty || busy === card.id}
                  onClick={() => void saveRow(card)}
                  className={`w-[70px] rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    justSaved === card.id
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-30'
                  }`}
                >
                  {justSaved === card.id ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckIcon className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  ) : busy === card.id ? (
                    'Saving…'
                  ) : (
                    'Save'
                  )}
                </button>

                <Tooltip
                  label={
                    channels.length > 0
                      ? `Archiving drops ${channels.length === 1 ? 'this channel' : `these ${channels.length} channels`} back to the account rate, then the agency default.`
                      : 'Stops this card being offered. Nothing already committed changes.'
                  }
                >
                  <button
                    type="button"
                    disabled={busy === card.id}
                    onClick={() => void patch(card, { archived: true }, `${card.label} archived`)}
                    aria-label={`Archive ${card.label}`}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30"
                  >
                    <ArchiveBoxIcon className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            );
          })}

          {adding && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-[var(--primary)]/50 bg-[var(--primary)]/5 px-3 py-3">
              <div className="min-w-[150px] flex-1">
                <input
                  autoFocus
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Rate card name"
                  aria-label="New rate card name"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <p className="mt-1 px-0.5 text-[11px] text-[var(--muted-foreground)]">
                  Assign channels to it under Channels.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={newMargin}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setNewMargin(v);
                  }}
                  placeholder="23"
                  aria-label="New rate card margin"
                  className="w-[68px] rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--primary)]"
                />
                <span className="text-sm text-[var(--muted-foreground)]">%</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewLabel('');
                    setNewMargin('');
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
                <PrimaryButton onClick={() => void create()} disabled={busy === 'new'}>
                  {busy === 'new' ? 'Adding…' : 'Add'}
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Archived cards. Kept and shown rather than deleted: budget lines and
          channels reference a category by key, so a hard delete would orphan
          history that still has to add up. */}
      {archived.length > 0 && (
        <section className="glass-section-card rounded-xl p-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm font-semibold text-[var(--foreground)]"
          >
            Archived ({archived.length})
          </button>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            An archived card resolves no rate, so its channels fall back to the account rate and
            then the agency default. Lines already created keep the rate frozen on them.
          </p>
          {showArchived && (
            <div className="mt-3 space-y-2">
              {archived.map((card) => (
                <div
                  key={card.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <span className="flex-1 text-sm text-[var(--muted-foreground)]">
                    {card.label}
                  </span>
                  <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                    {marginOf(card.markup)}%
                  </span>
                  <button
                    type="button"
                    disabled={busy === card.id}
                    onClick={() => void patch(card, { archived: false }, `${card.label} restored`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium transition hover:border-[var(--primary)] disabled:opacity-30"
                  >
                    <ArrowPathIcon className="h-3.5 w-3.5" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

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
            Assign each one a card under Channels.
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
