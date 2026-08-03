'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS, channelLabel } from '@/lib/budget/channels';
import { MONTH_ABBR, usd0 as usd, type AgreementFee, type BudgetAgreement } from './budget-shared';

/**
 * The account's agreements — what the client actually signed, with real term
 * dates and the recurring fees inside the term.
 *
 * REPLACES THE YEAR-KEYED PLAN. A plan filed under 2026 could only describe a
 * January-to-December commitment, and almost nobody signs one of those; a term
 * that starts in April belongs to two calendar years, each holding its share.
 * So an account has agreements, and the year you're viewing shows the slice of
 * each that lands in it.
 *
 * The list is the default view rather than a single form: an account can hold a
 * renewal alongside the term it renews, and seeing both is the point.
 */
export function BudgetAgreementModal({
  year,
  accountName,
  agreements,
  startNew = false,
  onSave,
  onArchive,
  onGenerate,
  onClose,
}: {
  year: number;
  accountName: string;
  agreements: BudgetAgreement[];
  /** Open straight into the form — set when the chooser already asked. */
  startNew?: boolean;
  onSave: (body: Record<string, unknown>, id: string | null) => Promise<boolean>;
  onArchive: (id: string) => Promise<boolean>;
  onGenerate: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<BudgetAgreement | 'new' | null>(
    // Straight into the form when the chooser already asked, or when there's
    // nothing to list — an empty list with a button in it is pure ceremony.
    startNew || agreements.length === 0 ? 'new' : null,
  );
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (editing && agreements.length > 0) setEditing(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, editing, agreements.length]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="animate-overlay-in fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="animate-modal-in frost-heavy flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              {editing ? (editing === 'new' ? 'New Budget' : 'Edit Budget') : 'Budgets'}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {accountName} · Viewing {year}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Keyed so switching list ↔ form replays the entrance rather than
            swapping content in place, which reads as a glitch at this size. */}
        {editing ? (
          <AgreementForm
            key={editing === 'new' ? 'new' : editing.id}
            year={year}
            agreement={editing === 'new' ? null : editing}
            busy={busy}
            setBusy={setBusy}
            onSave={onSave}
            onGenerate={onGenerate}
            onDone={() => (agreements.length > 0 ? setEditing(null) : onClose())}
            canCancel={agreements.length > 0}
          />
        ) : (
          <AgreementList
            year={year}
            agreements={agreements}
            busy={busy}
            onEdit={setEditing}
            onNew={() => setEditing('new')}
            onArchive={async (id) => {
              setBusy(true);
              await onArchive(id);
              setBusy(false);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── List ────────────────────────────────────────────────────────────────────

function AgreementList({
  year,
  agreements,
  busy,
  onEdit,
  onNew,
  onArchive,
}: {
  year: number;
  agreements: BudgetAgreement[];
  busy: boolean;
  onEdit: (a: BudgetAgreement) => void;
  onNew: () => void;
  onArchive: (id: string) => Promise<void>;
}) {
  const yearTotal = agreements.reduce((s, a) => s + (a.commitmentForYear ?? 0), 0);
  const anyCommitted = agreements.some((a) => a.committedAmount != null);

  return (
    <>
      <div className="animate-fade-in-up min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          {agreements.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onEdit(a)}
              className="group flex w-full items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-left transition hover:bg-[var(--muted)]/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">{a.name}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {fmtDate(a.startDate)} – {fmtDate(a.endDate)} · {a.termMonths} mo
                  {a.monthlyFeeTotal > 0 && <> · {usd(a.monthlyFeeTotal)}/mo recurring</>}
                </p>
              </div>
              <div className="flex items-center gap-3 whitespace-nowrap">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                    {a.commitmentForYear == null ? '—' : usd(a.commitmentForYear)}
                  </p>
                  {/* Drawdown — the number the agreement exists to be measured
                      against. A commitment with nothing booked on it is a
                      figure in a contract, not a budget. */}
                  {a.commitmentForYear != null && a.commitmentForYear > 0 ? (
                    <p
                      className={`text-[10px] ${
                        a.booked > a.commitmentForYear
                          ? 'font-medium text-amber-600'
                          : 'text-[var(--muted-foreground)]'
                      }`}
                    >
                      {usd(a.booked)} booked ·{' '}
                      {Math.round((a.booked / a.commitmentForYear) * 100)}%
                    </p>
                  ) : (
                    a.booked > 0 && (
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        {usd(a.booked)} booked
                      </p>
                    )
                  )}
                  {/* Only worth saying when the term ISN'T the whole year —
                      otherwise it's noise on every row. */}
                  {a.monthsInYear != null && a.monthsInYear < a.termMonths && (
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      {a.monthsInYear} of {a.termMonths} mo in {year}
                    </p>
                  )}
                </div>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Archive budget"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) void onArchive(a.id);
                  }}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] opacity-0 transition hover:bg-[var(--muted)] hover:text-red-500 group-hover:opacity-100"
                >
                  <TrashIcon className="h-4 w-4" />
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* A bar per agreement, under the list, so several agreements can be
            compared at a glance rather than by reading percentages. */}
        {agreements.some((a) => (a.commitmentForYear ?? 0) > 0) && (
          <div className="mt-3 space-y-2">
            {agreements
              .filter((a) => (a.commitmentForYear ?? 0) > 0)
              .map((a) => {
                const pct = Math.min(100, (a.booked / a.commitmentForYear!) * 100);
                const over = a.booked > a.commitmentForYear!;
                return (
                  <div key={a.id}>
                    <div className="flex items-baseline justify-between text-[10px] text-[var(--muted-foreground)]">
                      <span className="truncate">{a.name}</span>
                      <span className="tabular-nums">
                        {usd(a.booked)} of {usd(a.commitmentForYear!)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${
                          over ? 'bg-amber-500' : 'bg-[var(--primary)]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {agreements.length > 1 && anyCommitted && (
          <div className="mt-3 flex justify-between border-t border-[var(--border)] pt-3 text-xs">
            <span className="text-[var(--muted-foreground)]">Committed for {year}</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]">{usd(yearTotal)}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2 border-t border-[var(--border)] px-5 py-3.5">
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          <PlusIcon className="h-4 w-4" />
          New Budget
        </button>
      </div>
    </>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────

type PieceDraft = { label: string; amount: string };

/**
 * One line item being edited, with its total held SEPARATELY from its pieces.
 *
 * This is the whole point of the shape. If the item's amount were just the sum
 * of its pieces, then splitting a $3,000 Google buy and typing "Search 500"
 * would silently make it a $3,500 buy — the number somebody committed to would
 * move because someone else got granular. The total is what was agreed; pieces
 * divide it, and anything not yet attributed stays visible as a remainder.
 */
type ItemDraft = { channel: string; total: string; pieces: PieceDraft[] };

function AgreementForm({
  year,
  agreement,
  busy,
  setBusy,
  onSave,
  onGenerate,
  onDone,
  canCancel,
}: {
  year: number;
  agreement: BudgetAgreement | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSave: (body: Record<string, unknown>, id: string | null) => Promise<boolean>;
  onGenerate: (id: string) => Promise<void>;
  onDone: () => void;
  canCancel: boolean;
}) {
  const [name, setName] = useState(agreement?.name ?? `${year} Budget`);
  // Months, not dates. A budget runs for whole months — asking for a start and
  // end DAY made people pick 03/23–03/28 and get a one-month budget they didn't
  // mean, and the extra precision never reached the ledger anyway.
  const [startMonth, setStartMonth] = useState(
    agreement ? agreement.startDate.slice(0, 7) : `${year}-01`,
  );
  const [endMonth, setEndMonth] = useState(
    agreement ? agreement.endDate.slice(0, 7) : `${year}-12`,
  );
  const [spansMonths, setSpansMonths] = useState(
    agreement ? agreement.startDate.slice(0, 7) !== agreement.endDate.slice(0, 7) : true,
  );
  const [items, setItems] = useState<ItemDraft[]>(() => groupFees(agreement?.fees ?? []));

  // A one-month budget ends where it starts; the end select is only meaningful
  // when the budget actually runs across months.
  const effectiveEnd = spansMonths ? endMonth : startMonth;
  const startDate = `${startMonth}-01`;
  const endDate = lastDayOf(effectiveEnd);

  const term = useMemo(() => describeTerm(startDate, endDate, year), [startDate, endDate, year]);

  /** Each item's own numbers: what it's worth, and how much is attributed. */
  const itemMath = useMemo(
    () =>
      items.map((it) => {
        const total = Number(it.total) || 0;
        const assigned = it.pieces.reduce((t, p) => t + (Number(p.amount) || 0), 0);
        return { total, assigned, remainder: total - assigned };
      }),
    [items],
  );
  // The budget's monthly cost is the sum of the ITEMS' totals, not of the
  // pieces — an item that hasn't been fully attributed still costs its total.
  const monthlyFeeTotal = itemMath.reduce((s, m) => s + m.total, 0);
  const overAssigned = itemMath.some((m) => m.remainder < -0.005);

  /**
   * The budget's whole value, DERIVED rather than typed.
   *
   * There used to be a "total commitment" field next to the items, which meant
   * the same number existed twice and could disagree with itself. A recurring
   * budget IS its items across its months, so that's what this is. Falls back
   * to whatever was stored when there are no items yet, so editing an old
   * budget can't silently zero its total.
   */
  const committedNum =
    monthlyFeeTotal > 0 && term.valid
      ? round2(monthlyFeeTotal * term.total)
      : (agreement?.committedAmount ?? null);
  const yearShare =
    committedNum != null && term.valid && term.total > 0
      ? (committedNum * term.inYear) / term.total
      : null;

  const feesValid = items.every((it) => it.channel && Number(it.total) > 0);
  const canSave = name.trim() !== '' && term.valid && feesValid && !busy;

  const body = () => ({
    name: name.trim(),
    startDate,
    endDate,
    committedAmount: committedNum,
    // No longer editable here — a per-budget rate is a rare exception and the
    // rate cards cover the normal case. Passed through unchanged so editing a
    // budget that has one doesn't wipe it.
    defaultMarkup: agreement?.defaultMarkup ?? null,
    // Flattened back to one row per line the layout will create. An item with
    // no pieces is a single row; a split one contributes its pieces PLUS the
    // unattributed remainder, so the item's total survives the round trip
    // instead of shrinking to whatever happened to be named.
    fees: items.flatMap((it, i) => {
      if (!it.channel || itemMath[i]!.total <= 0) return [];
      const named = it.pieces
        .filter((p) => Number(p.amount) > 0)
        .map((p) => ({
          channel: it.channel,
          monthlyAmount: Number(p.amount),
          label: p.label.trim() || null,
        }));
      if (named.length === 0) {
        return [{ channel: it.channel, monthlyAmount: itemMath[i]!.total, label: null }];
      }
      const remainder = itemMath[i]!.remainder;
      return remainder > 0.005
        ? [...named, { channel: it.channel, monthlyAmount: round2(remainder), label: null }]
        : named;
    }),
  });

  const save = async (thenGenerate: boolean) => {
    setBusy(true);
    const ok = await onSave(body(), agreement?.id ?? null);
    if (ok && thenGenerate && agreement?.id) await onGenerate(agreement.id);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <>
      <div className="animate-fade-in-up min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label className="block text-xs font-medium text-[var(--foreground)]">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${year} Annual Budget`}
            className="loomi-input mt-1 w-full !bg-[var(--input)]"
          />
        </div>

        {/* One month or several. Months, not dates — the ledger only ever
            holds whole months, and asking for days invited precision that
            nothing downstream uses. */}
        <div>
          <label className="block text-xs font-medium text-[var(--foreground)]">
            How long does it run?
          </label>
          <div className="mt-1.5 flex rounded-lg bg-[var(--muted)]/40 p-0.5">
            {(
              [
                { key: false, label: 'One month' },
                { key: true, label: 'Multiple months' },
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.key)}
                type="button"
                onClick={() => setSpansMonths(opt.key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  spansMonths === opt.key
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className={`mt-2 grid gap-3 ${spansMonths ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted-foreground)]">
                {spansMonths ? 'From' : 'Month'}
              </label>
              <div className="mt-1">
                <SearchableSelect
                  value={startMonth}
                  onChange={(v) => {
                    setStartMonth(v);
                    // Keep the range sane rather than letting it go backwards.
                    if (spansMonths && v > effectiveEnd) setEndMonth(v);
                  }}
                  searchable={false}
                  options={monthOptions(year)}
                  className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                />
              </div>
            </div>
            {spansMonths && (
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Through
                </label>
                <div className="mt-1">
                  <SearchableSelect
                    value={effectiveEnd}
                    onChange={setEndMonth}
                    searchable={false}
                    options={monthOptions(year).filter((o) => o.value >= startMonth)}
                    className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <p
            className={`mt-1.5 text-[11px] ${term.valid ? 'text-[var(--muted-foreground)]' : 'text-red-500'}`}
          >
            {term.text}
          </p>
        </div>

        {/* ── Line items ──
            Grouped by item, with sub-items under it. A flat list of rows with
            a name column technically allows the same thing — two Videos rows
            named differently — but it doesn't READ as splitting an item, so
            nobody finds it. The hierarchy is the affordance. */}
        <div className="border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--foreground)]">Line items</p>
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                Charged every month of the term. Split an item to divide its budget between
                named pieces — one Video as &ldquo;Commercial&rdquo;, another as
                &ldquo;Kick-off&rdquo;.
              </p>
            </div>
            {monthlyFeeTotal > 0 && (
              <span className="whitespace-nowrap text-right">
                <span className="block text-xs font-semibold tabular-nums text-[var(--foreground)]">
                  {usd(monthlyFeeTotal)}/mo
                </span>
                {/* The whole budget, derived. This replaced a "total
                    commitment" field, which meant the same number existed
                    twice and could disagree with itself. */}
                {committedNum != null && term.valid && (
                  <span className="mt-0.5 block text-[10px] text-[var(--muted-foreground)]">
                    {usd(committedNum)} over {term.total} month{term.total === 1 ? '' : 's'}
                    {yearShare != null && term.inYear < term.total && (
                      <> · {usd(yearShare)} in {year}</>
                    )}
                  </span>
                )}
                {/* Warn, don't block — the same rule the rest of the module
                    follows. An over-split item is usually a typo, but it's not
                    this form's place to refuse someone's number. */}
                {overAssigned && (
                  <span className="mt-0.5 block text-[10px] font-medium text-amber-600">
                    An item is split past its total
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="mt-2.5 space-y-2">
            {items.map((item, i) => {
              const math = itemMath[i]!;
              const split = item.pieces.length > 0;
              const set = (patch: Partial<ItemDraft>) =>
                setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

              return (
                <div
                  key={i}
                  className="animate-fade-in-up rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchableSelect
                        value={item.channel}
                        onChange={(v) => set({ channel: v })}
                        options={BUDGET_CHANNELS.map((c) => ({
                          value: c.key,
                          label: c.label,
                          icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                        }))}
                        className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                      />
                    </div>

                    {/* Stays editable when split. The item's total is what was
                        agreed; pieces divide it. If this became a read-only sum
                        of the pieces, adding one would move the committed
                        number, which is nobody's intent. */}
                    <MoneyInput value={item.total} onChange={(v) => set({ total: v })} />

                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-red-500"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {split && (
                    <>
                      <div className="mt-2 space-y-1.5 border-l border-[var(--border)] pl-3">
                        {item.pieces.map((piece, pi) => (
                          <div key={pi} className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="Name this piece"
                              value={piece.label}
                              onChange={(e) =>
                                set({
                                  pieces: item.pieces.map((x, k) =>
                                    k === pi ? { ...x, label: e.target.value } : x,
                                  ),
                                })
                              }
                              className="loomi-input min-w-0 flex-1 !bg-[var(--input)] !py-1.5 !text-xs"
                            />
                            <MoneyInput
                              value={piece.amount}
                              onChange={(v) =>
                                set({
                                  pieces: item.pieces.map((x, k) =>
                                    k === pi ? { ...x, amount: v } : x,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              aria-label="Remove piece"
                              onClick={() =>
                                set({ pieces: item.pieces.filter((_, k) => k !== pi) })
                              }
                              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-red-500"
                            >
                              <XMarkIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Where the item's money actually stands. Splitting is
                          the moment someone might accidentally change a number
                          they only meant to describe, so the arithmetic is on
                          screen rather than in their head. */}
                      <p
                        className={`mt-1.5 pl-3 text-[11px] tabular-nums ${
                          math.remainder < -0.005
                            ? 'font-medium text-amber-600'
                            : 'text-[var(--muted-foreground)]'
                        }`}
                      >
                        {math.remainder < -0.005 ? (
                          <>
                            Pieces come to {usd(math.assigned)} — {usd(-math.remainder)} more than
                            the {usd(math.total)} set for this item.
                          </>
                        ) : math.remainder > 0.005 ? (
                          <>
                            {usd(math.assigned)} of {usd(math.total)} split ·{' '}
                            {usd(math.remainder)} stays as {channelLabel(item.channel)}
                          </>
                        ) : (
                          <>Fully split across {item.pieces.length} pieces</>
                        )}
                      </p>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      set({
                        pieces: [
                          ...item.pieces,
                          // The first split seeds a piece with the whole amount
                          // so nothing has to be re-typed and the total is
                          // visibly unchanged; the next one starts empty.
                          ...(split
                            ? [{ label: '', amount: '' }]
                            : [{ label: channelLabel(item.channel), amount: item.total }]),
                        ],
                      })
                    }
                    className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <PlusIcon className="h-3 w-3" />
                    {split ? 'Add another piece' : 'Split this item'}
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() =>
              setItems((prev) => [
                ...prev,
                { channel: nextUnusedChannel(prev), total: '', pieces: [] },
              ])
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add an item
          </button>
        </div>
      </div>

      {/* Lay out the year — an action, not a field, so it gets its own block
          rather than sitting beside Save as a peer. Only offered on an
          agreement that already exists; there's no id to generate against
          until the first save. */}
      {agreement && (
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-5 py-4">
          <p className="text-xs font-medium text-[var(--foreground)]">Lay out {year}</p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {monthlyFeeTotal === 0
              ? 'Add a recurring fee above to enable this.'
              : `Creates a line for each fee in each of the ${term.inYear} month${term.inYear === 1 ? '' : 's'} of ${year} this term covers, skipping any that already exist — safe to re-run.`}
          </p>
          <button
            type="button"
            disabled={!canSave || monthlyFeeTotal === 0}
            onClick={() => void save(true)}
            className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Save &amp; lay out
          </button>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
        {canCancel && (
          <button
            type="button"
            onClick={onDone}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Back
          </button>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save(false)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : agreement ? 'Save Changes' : 'Create Budget'}
        </button>
      </div>
    </>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

/** Term length and how much of it lands in the year being viewed. */
function describeTerm(startISO: string, endISO: string, year: number) {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  if (!s || !e) return { valid: false, total: 0, inYear: 0, text: 'Pick a start and end date.' };
  if (e < s) return { valid: false, total: 0, inYear: 0, text: 'The end date is before the start date.' };

  const total = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const cs = s > from ? s : from;
  const ce = e < to ? e : to;
  const inYear =
    cs > ce ? 0 : (ce.getUTCFullYear() - cs.getUTCFullYear()) * 12 + (ce.getUTCMonth() - cs.getUTCMonth()) + 1;

  const text =
    inYear === 0
      ? `${total}-month term — none of it falls in ${year}.`
      : inYear === total
        ? `${total}-month term, entirely within ${year}.`
        : `${total}-month term · ${inYear} month${inYear === 1 ? '' : 's'} of it in ${year}.`;
  return { valid: true, total, inYear, text };
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fmtDate(iso: string) {
  const d = parseISO(iso);
  if (!d) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}



export type { AgreementFee };

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-28 flex-shrink-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
        $
      </span>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="loomi-input w-full !bg-[var(--input)] !py-1.5 !pl-6 !text-xs"
      />
    </div>
  );
}

/**
 * A channel not already on the budget, so "Add an item" doesn't silently
 * produce a second row of the same thing — which would render as a SPLIT of
 * the existing item rather than the new item the user asked for.
 */
function nextUnusedChannel(items: ItemDraft[]): string {
  const used = new Set(items.map((i) => i.channel));
  return (BUDGET_CHANNELS.find((c) => !used.has(c.key)) ?? BUDGET_CHANNELS[0]!).key;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Stored fee rows → the nested shape the form edits.
 *
 * A channel with one unnamed row is an unsplit item. Anything else is split,
 * and its total is the sum of what's stored — which is exactly what was saved,
 * remainder included, so a round trip through the form is lossless.
 */
function groupFees(fees: AgreementFee[]): ItemDraft[] {
  const order: string[] = [];
  const byChannel = new Map<string, AgreementFee[]>();
  for (const f of fees) {
    if (!byChannel.has(f.channel)) {
      byChannel.set(f.channel, []);
      order.push(f.channel);
    }
    byChannel.get(f.channel)!.push(f);
  }
  return order.map((channel) => {
    const rows = byChannel.get(channel)!;
    const total = String(round2(rows.reduce((t, r) => t + r.monthlyAmount, 0)));
    const unsplit = rows.length === 1 && !rows[0]!.label;
    return {
      channel,
      total,
      pieces: unsplit
        ? []
        : rows.map((r) => ({ label: r.label ?? '', amount: String(r.monthlyAmount) })),
    };
  });
}

/** `2026-03` → `2026-03-31`. The ledger runs on whole months. */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * Selectable months: the year being viewed and the next one.
 *
 * Next year is included because a budget crossing the calendar boundary is the
 * ordinary case — a twelve-month term signed in April ends the following March
 * — and it's the whole reason budgets carry real terms rather than a year.
 */
function monthOptions(year: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const y of [year, year + 1]) {
    for (let m = 1; m <= 12; m++) {
      out.push({
        value: `${y}-${String(m).padStart(2, '0')}`,
        label: `${MONTH_ABBR[m - 1]} ${y}`,
      });
    }
  }
  return out;
}
