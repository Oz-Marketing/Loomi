'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS } from '@/lib/budget/channels';
import { usd0 as usd, type AgreementFee, type BudgetAgreement } from './budget-shared';

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
  onSave,
  onArchive,
  onGenerate,
  onClose,
}: {
  year: number;
  accountName: string;
  agreements: BudgetAgreement[];
  onSave: (body: Record<string, unknown>, id: string | null) => Promise<boolean>;
  onArchive: (id: string) => Promise<boolean>;
  onGenerate: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<BudgetAgreement | 'new' | null>(
    // Straight into the form when there's nothing to list — an empty list with
    // a button in it is one click of pure ceremony.
    agreements.length === 0 ? 'new' : null,
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
              {editing ? (editing === 'new' ? 'New Agreement' : 'Edit Agreement') : 'Agreements'}
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
                  aria-label="Archive agreement"
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
          New Agreement
        </button>
      </div>
    </>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────

type FeeDraft = { channel: string; monthlyAmount: string; label: string };

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
  const [name, setName] = useState(agreement?.name ?? `${year} Agreement`);
  const [startDate, setStartDate] = useState(agreement?.startDate ?? `${year}-01-01`);
  const [endDate, setEndDate] = useState(agreement?.endDate ?? `${year}-12-31`);
  const [committed, setCommitted] = useState(
    agreement?.committedAmount != null ? String(agreement.committedAmount) : '',
  );
  const [markup, setMarkup] = useState(
    agreement?.defaultMarkup != null ? String(agreement.defaultMarkup) : '',
  );
  const [fees, setFees] = useState<FeeDraft[]>(
    agreement?.fees.map((f) => ({
      channel: f.channel,
      monthlyAmount: String(f.monthlyAmount),
      label: f.label ?? '',
    })) ?? [],
  );

  const term = useMemo(() => describeTerm(startDate, endDate, year), [startDate, endDate, year]);
  const monthlyFeeTotal = fees.reduce((s, f) => s + (Number(f.monthlyAmount) || 0), 0);

  const committedNum = committed === '' ? null : Number(committed);
  const yearShare =
    committedNum != null && term.valid && term.total > 0
      ? (committedNum * term.inYear) / term.total
      : null;

  // A markup under 0.5 means the agency keeps more than half the budget, which
  // is possible but rare — far more often it's a margin (0.23) typed where the
  // spend factor (0.77) belongs.
  const markupNum = markup === '' ? null : Number(markup);
  const markupValid = markupNum != null && Number.isFinite(markupNum) && markupNum > 0;
  const markupSuspicious = markupValid && markupNum < 0.5;

  const feesValid = fees.every((f) => f.channel && Number(f.monthlyAmount) > 0);
  const canSave = name.trim() !== '' && term.valid && feesValid && !busy;

  const body = () => ({
    name: name.trim(),
    startDate,
    endDate,
    committedAmount: committedNum,
    defaultMarkup: markup === '' ? null : Number(markup),
    fees: fees
      .filter((f) => f.channel && Number(f.monthlyAmount) > 0)
      .map((f) => ({
        channel: f.channel,
        monthlyAmount: Number(f.monthlyAmount),
        label: f.label.trim() || null,
      })),
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
            placeholder={`${year} Annual Agreement`}
            className="loomi-input mt-1 w-full !bg-[var(--input)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DateField label="Starts" value={startDate} onChange={setStartDate} />
          <DateField label="Ends" value={endDate} onChange={setEndDate} />
        </div>
        <p className={`-mt-2 text-[11px] ${term.valid ? 'text-[var(--muted-foreground)]' : 'text-red-500'}`}>
          {term.text}
        </p>

        <MoneyField
          label="Total commitment"
          hint="The whole contract value, not the year's. Leave blank if there's no formal number — the page just won't show a target."
          value={committed}
          onChange={setCommitted}
        />
        {/* The pro-rated share, live. A term that crosses the new year is the
            whole reason this model exists, and showing the split at entry is
            what stops someone typing the year's number into the term field. */}
        {yearShare != null && term.inYear < term.total && (
          <p className="-mt-2 text-[11px] text-[var(--muted-foreground)]">
            {usd(yearShare)} of that falls in {year} ({term.inYear} of {term.total} months).
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-[var(--foreground)]">Markup override</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            placeholder="Account default"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            className="loomi-input mt-1 w-full !bg-[var(--input)]"
          />
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            Spend = budget × markup, frozen onto each new line — changing it never rewrites money
            already committed.
            {markupValid && (
              <>
                {' '}
                <span className={markupSuspicious ? 'font-medium text-amber-600' : ''}>
                  A {usd(10_000)} budget would target {usd(10_000 * markupNum)} in spend
                  {markupSuspicious ? ` — did you mean ${(1 - markupNum).toFixed(2)}?` : '.'}
                </span>
              </>
            )}
          </p>
        </div>

        {/* ── Recurring fees ── */}
        <div className="border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--foreground)]">Recurring monthly fees</p>
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                Charged every month of the term. These become budget lines when you lay out the
                year.
              </p>
            </div>
            {monthlyFeeTotal > 0 && (
              <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-[var(--foreground)]">
                {usd(monthlyFeeTotal)}/mo
              </span>
            )}
          </div>

          <div className="mt-2.5 space-y-2">
            {fees.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    value={f.channel}
                    onChange={(v) =>
                      setFees((prev) => prev.map((x, j) => (j === i ? { ...x, channel: v } : x)))
                    }
                    options={BUDGET_CHANNELS.map((c) => ({
                      value: c.key,
                      label: c.label,
                      icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                    }))}
                    className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                  />
                </div>
                <div className="relative w-32">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    value={f.monthlyAmount}
                    onChange={(e) =>
                      setFees((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, monthlyAmount: e.target.value } : x)),
                      )
                    }
                    className="loomi-input w-full !bg-[var(--input)] !py-1.5 !pl-6 !text-xs"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove fee"
                  onClick={() => setFees((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-red-500"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setFees((prev) => [
                ...prev,
                { channel: 'managed_marketing_services', monthlyAmount: '', label: '' },
              ])
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add a fee
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
          {busy ? 'Saving…' : agreement ? 'Save Changes' : 'Create Agreement'}
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

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--foreground)]">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="loomi-input mt-1 w-full !bg-[var(--input)]"
      />
    </div>
  );
}

function MoneyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--foreground)]">{label}</label>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">
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
          className="loomi-input w-full !bg-[var(--input)] !pl-6"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export type { AgreementFee };
