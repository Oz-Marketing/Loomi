'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUturnLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { BUDGET_CHANNELS, channelLabel, isPacedChannel } from '@/lib/budget/channels';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { periodOf } from '@/lib/budget/period';
import { jsonFetcher } from './fetcher';
import { StatusPill } from './budget-status-pill';
import {
  EDITABLE_STATUSES,
  MONTH_ABBR,
  bucketLabel,
  monthIndexOf,
  sourceLabel,
  statusLabel,
  usd2,
  type BudgetLine,
  type BudgetLineEvent,
} from './budget-shared';

/**
 * One budget line: what it is, where it sits, and everything that's happened to
 * it. Edits go through PATCH; releasing money goes through the dedicated
 * to-pool path so it lands somewhere instead of vanishing from the year.
 */
export function BudgetLineDrawer({
  lineId,
  year,
  onClose,
  onChanged,
}: {
  lineId: string;
  year: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [line, setLine] = useState<BudgetLine | null>(null);
  const [events, setEvents] = useState<BudgetLineEvent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Draft edits — applied on Save so a mistyped amount doesn't fire a PATCH per
  // keystroke (and per keystroke, a pacer re-sync).
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [status, setStatus] = useState('committed');
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await jsonFetcher(`/api/budget/lines/${lineId}`);
      setLine(d.line);
      setEvents(d.events);
      setAmount(String(d.line.amount));
      setChannel(d.line.channel ?? '');
      setMonth(d.line.period ? String(Number(d.line.period.slice(5, 7))) : '');
      setStatus(d.line.status);
      setLabel(d.line.label ?? '');
    } catch {
      setLoadError(true);
    }
  }, [lineId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes, matching the rest of the app's overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/budget/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: n,
          // Empty means "back to the pool" — sent as an explicit null so the
          // route can tell it apart from "leave alone".
          channel: channel || null,
          period: month ? periodOf(year, Number(month)) : null,
          status,
          label: label.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save');
      toast.success('Line updated');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function release(toPool: boolean) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/budget/lines/${lineId}?toPool=${toPool}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not release the line');
      toast.success(toPool ? 'Money returned to the pool' : 'Line canceled');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not release the line');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="animate-overlay-in absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      {/* frost-heavy, not bg-[var(--card)] — `--card` is 62% opaque by design
          for in-page surfaces, which makes a floating panel unreadable over
          the grid behind it. */}
      <div className="animate-slide-in-right frost-heavy relative flex h-full w-full max-w-md flex-col overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-inherit px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">
              {line?.label || line?.taskTitle || 'Budget line'}
            </p>
            {line && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <StatusPill status={line.status} />
                <ChannelIcon channel={line.channel} className="h-3.5 w-3.5" />
                <span>
                  {line.channel ? channelLabel(line.channel) : 'Unassigned channel'}
                  {' · '}
                  {line.period
                    ? `${MONTH_ABBR[monthIndexOf(line.period)]} ${line.year}`
                    : 'Unscheduled'}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {loadError ? (
          <p className="p-5 text-sm text-[var(--muted-foreground)]">Couldn&apos;t load this line.</p>
        ) : !line ? (
          <p className="p-5 text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : (
          <div className="flex-1 space-y-5 p-5">
            {/* Money summary — what the client pays vs what should hit the
                platform, with the frozen factor named so the number is
                traceable rather than magic. */}
            <div className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-[var(--muted-foreground)]">Client budget</span>
                <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                  {usd2(line.amount)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-[var(--muted-foreground)]">
                  Spend target · markup {line.markupSnapshot}
                </span>
                <span className="text-sm tabular-nums text-[var(--muted-foreground)]">
                  {usd2(line.spendTarget)}
                </span>
              </div>
              {line.isCrossAccount && (
                <p className="mt-2 rounded-lg bg-[var(--muted)] px-2 py-1.5 text-[11px] text-[var(--muted-foreground)]">
                  Billed to {line.accountDealer ?? line.accountKey}, spends from{' '}
                  {line.spendAccountDealer ?? line.spendAccountKey}.
                </p>
              )}
              {line.actualAmount != null && (
                <div className="mt-2 flex items-baseline justify-between border-t border-[var(--border)] pt-2">
                  <span className="text-xs text-[var(--muted-foreground)]">Actual spend</span>
                  <span className="text-right">
                    <span className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                      {usd2(line.actualAmount)}
                    </span>
                    {(() => {
                      const delta = line.actualAmount! - line.spendTarget;
                      if (Math.abs(delta) < 0.005) {
                        return (
                          <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
                            on target
                          </span>
                        );
                      }
                      return (
                        <span
                          className={`ml-2 text-[11px] font-medium ${delta > 0 ? 'text-amber-600' : 'text-[var(--muted-foreground)]'}`}
                        >
                          {usd2(Math.abs(delta))} {delta > 0 ? 'over' : 'under'}
                        </span>
                      );
                    })()}
                  </span>
                </div>
              )}
              {line.channel && isPacedChannel(line.channel) && line.period && (
                <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                  Feeds the Ad Pacer&apos;s <strong>{bucketLabel(line.bucket)}</strong> budget for{' '}
                  {line.period} when that month is budget-managed.
                </p>
              )}
            </div>

            {/* Part of a flight. Worth saying explicitly: the amount on this
                row is a DERIVED share of a bigger buy, so editing it in
                isolation is almost never what someone means — the flight is
                the thing to change. */}
            {line.flightId && line.flightStart && line.flightEnd && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
                <p className="text-xs font-medium text-[var(--foreground)]">
                  One month of a flight
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {fmtDay(line.flightStart)} – {fmtDay(line.flightEnd)}. This month&rsquo;s share is
                  weighted by how many of the flight&rsquo;s days fall in it — change the flight
                  rather than this line, or the parts stop adding up to the buy.
                </p>
              </div>
            )}

            {/* Provenance */}
            <div className="space-y-1.5 text-xs">
              <Row label="Source" value={sourceLabel(line.source)} />
              <Row label="Pacer bucket" value={bucketLabel(line.bucket)} />
              {line.taskId && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[var(--muted-foreground)]">Ticket</span>
                  <Link
                    href={`/projects/tasks/${line.taskId}`}
                    className="truncate text-right text-[var(--primary)] hover:underline"
                  >
                    {line.taskTitle ?? 'Open ticket'}
                  </Link>
                </div>
              )}
              {line.initiativeId && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[var(--muted-foreground)]">Initiative</span>
                  <Link
                    href={`/projects/initiatives/${line.initiativeId}`}
                    className="truncate text-right text-[var(--primary)] hover:underline"
                  >
                    {line.initiativeName ?? 'Open initiative'}
                  </Link>
                </div>
              )}
            </div>

            {/* Allocate — pool lines only.
                Distinct from Edit below, which MOVES the whole line. This
                splits part of it off onto a channel + month and leaves the
                remainder pooled, which is how a contingency actually gets
                spent: a piece at a time, as plans firm up. */}
            {line.isPool && (
              <AllocateBlock
                line={line}
                year={year}
                onDone={async () => {
                  await load();
                  onChanged();
                }}
              />
            )}

            {/* Edit */}
            <div className="space-y-3 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Edit
              </p>

              <label className="block">
                <span className="text-xs text-[var(--muted-foreground)]">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="loomi-input mt-1 w-full !bg-[var(--input)]"
                />
              </label>

              <label className="block">
                <span className="text-xs text-[var(--muted-foreground)]">Label</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Summer Sales Event"
                  className="loomi-input mt-1 w-full !bg-[var(--input)]"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-xs text-[var(--muted-foreground)]">Channel</span>
                  <div className="mt-1">
                    <SearchableSelect
                      value={channel}
                      onChange={setChannel}
                      searchable={false}
                      options={[
                        { value: '', label: 'Unassigned' },
                        ...BUDGET_CHANNELS.map((c) => ({
                          value: c.key,
                          label: c.label,
                          icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                        })),
                      ]}
                      className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
                    />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-[var(--muted-foreground)]">Month</span>
                  <div className="mt-1">
                    <SearchableSelect
                      value={month}
                      onChange={setMonth}
                      searchable={false}
                      options={[
                        { value: '', label: 'Unscheduled' },
                        ...MONTH_ABBR.map((m: string, i: number) => ({
                          value: String(i + 1),
                          label: m,
                        })),
                      ]}
                      className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Clearing either one sends this line back to the unassigned pool.
              </p>

              <div>
                <span className="text-xs text-[var(--muted-foreground)]">Status</span>
                <div className="mt-1">
                  <SearchableSelect
                    value={status}
                    onChange={setStatus}
                    searchable={false}
                    options={EDITABLE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
                    className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
                  />
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  Only committed, live, and settled count against the year.
                </p>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <SettleBlock
              line={line}
              onDone={async () => {
                await load();
                onChanged();
              }}
            />

            {/* Release */}
            <div className="space-y-2 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Release
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void release(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
              >
                <ArrowUturnLeftIcon className="h-4 w-4" />
                Return to pool
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void release(false)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
                Cancel this line
              </button>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Returning keeps the money on the account as unassigned. Canceling takes it off the
                year entirely.
              </p>
            </div>

            {/* Trail */}
            <div className="border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                History
              </p>
              <ul className="space-y-2.5">
                {events.map((e) => (
                  <li key={e.id} className="text-xs">
                    <p className="text-[var(--foreground)]">{e.summary}</p>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {e.author?.name ?? 'System'} ·{' '}
                      {new Date(e.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="text-right text-[var(--foreground)]">{value}</span>
    </div>
  );
}

/**
 * Split money off a pool line onto a channel + month.
 *
 * Deliberately separate from the Edit block: Edit re-places the whole line,
 * this peels a piece off and leaves the rest pooled. Both are useful and they
 * are not the same action — collapsing them would mean every partial
 * allocation started by guessing what the leftover should be.
 */
function AllocateBlock({
  line,
  year,
  onDone,
}: {
  line: BudgetLine;
  year: number;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState('');
  const [month, setMonth] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const entered = Number(amount);
  const valid = Number.isFinite(entered) && entered > 0;
  const remainder = valid ? line.amount - entered : line.amount;
  const tooMuch = valid && entered > line.amount;

  async function allocate() {
    if (!valid) {
      toast.error('Enter an amount to allocate');
      return;
    }
    if (!channel || !month) {
      toast.error('Pick a channel and a month');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/budget/lines/${line.id}/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: entered,
          channel,
          period: periodOf(year, Number(month)),
          label: label.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not allocate');
      toast.success(
        remainder > 0
          ? `${usd2(entered)} allocated · ${usd2(remainder)} left in the pool`
          : `${usd2(entered)} allocated · pool line fully drained`,
      );
      setAmount('');
      setLabel('');
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not allocate');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3.5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">
          Allocate
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
          Put some of this {usd2(line.amount)} onto a channel and month. Whatever&apos;s left stays
          in the pool.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-[var(--muted-foreground)]">Amount</span>
          <input
            type="number"
            min="0"
            step="any"
            placeholder={String(line.amount)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="loomi-input mt-1 w-full !bg-[var(--input)]"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setAmount(String(line.amount))}
            className="mb-[1px] rounded-lg border border-[var(--border)] px-2.5 py-2 text-xs text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            All of it
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-xs text-[var(--muted-foreground)]">Channel</span>
          <div className="mt-1">
            <SearchableSelect
              value={channel}
              onChange={setChannel}
              searchable={false}
              placeholder="Pick one"
              options={BUDGET_CHANNELS.map((c) => ({
                value: c.key,
                label: c.label,
                icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
              }))}
              className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
            />
          </div>
        </div>
        <div>
          <span className="text-xs text-[var(--muted-foreground)]">Month</span>
          <div className="mt-1">
            <SearchableSelect
              value={month}
              onChange={setMonth}
              searchable={false}
              placeholder="Pick one"
              options={MONTH_ABBR.map((m: string, i: number) => ({
                value: String(i + 1),
                label: m,
              }))}
              className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
            />
          </div>
        </div>
      </div>

      <input
        type="text"
        placeholder="Label for the new line (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="loomi-input w-full !bg-[var(--input)]"
      />

      {/* State the outcome before they commit to it — a split is two rows
          afterwards, and "where did my $15k go" is the confusing version. */}
      {valid && (
        <p
          className={`text-[11px] ${tooMuch ? 'font-medium text-amber-600' : 'text-[var(--muted-foreground)]'}`}
        >
          {tooMuch
            ? `That's more than this line holds (${usd2(line.amount)}).`
            : remainder > 0
              ? `Leaves ${usd2(remainder)} in the pool.`
              : 'Uses the whole line — nothing left in the pool.'}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !valid || tooMuch || !channel || !month}
        onClick={() => void allocate()}
        className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Allocating…' : 'Allocate'}
      </button>
    </div>
  );
}

/**
 * Close a line out, or reopen a settled one.
 *
 * Platform lines settle themselves from synced spend once the month closes —
 * this is the manual route for the channels with nothing to sync from (radio,
 * print, TV, video, PR) and the correction path when a synced figure is wrong.
 */
function SettleBlock({
  line,
  onDone,
}: {
  line: BudgetLine;
  onDone: () => Promise<void>;
}) {
  const [actual, setActual] = useState('');
  const [busy, setBusy] = useState(false);
  const settled = line.status === 'settled';
  // Settled WITHOUT a recorded actual is a real state — a status edit by hand,
  // or a pre-Phase-4 line. Saying "recorded actual below" there points at an
  // empty field.
  const hasActual = line.actualAmount != null;
  const paced = isPacedChannel(line.channel);

  useEffect(() => {
    setActual(line.actualAmount != null ? String(line.actualAmount) : '');
  }, [line.actualAmount]);

  async function settle() {
    const n = Number(actual);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter what it actually cost');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/budget/lines/${line.id}/settle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actualAmount: n }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not settle');
      toast.success(settled ? 'Actual updated' : 'Line settled');
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not settle');
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      const res = await fetch(`/api/budget/lines/${line.id}/settle`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not reopen');
      toast.success('Reopened — recorded actual cleared');
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-[var(--border)] pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {settled && hasActual ? 'Settled' : 'Close out'}
      </p>
      <p className="text-[11px] text-[var(--muted-foreground)]">
        {settled && hasActual
          ? 'Recorded actual below. Correct it, or reopen to clear it.'
          : settled
            ? 'Marked settled, but nothing was recorded for what it cost. Enter it below.'
            : paced
              ? 'This channel settles on its own from synced spend once the month closes. Record it by hand only to override.'
              : 'No platform to sync from — record what it actually cost when the month is done.'}
      </p>

      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="text-xs text-[var(--muted-foreground)]">Actual spend</span>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">
              $
            </span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={line.spendTarget.toFixed(2)}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className="loomi-input w-full !bg-[var(--input)] !pl-6"
            />
          </div>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void settle()}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
        >
          {hasActual ? 'Update' : 'Settle'}
        </button>
      </div>
      {/* Spend dollars, not client gross — it's what hit the platform, and
          grossing it back up through a markup would invent precision. */}
      <p className="text-[11px] text-[var(--muted-foreground)]">
        In spend dollars, against a {usd2(line.spendTarget)} target.
      </p>

      {settled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void reopen()}
          className="text-[11px] text-[var(--muted-foreground)] underline underline-offset-2 transition hover:text-[var(--foreground)] disabled:opacity-50"
        >
          Reopen for correction
        </button>
      )}
    </div>
  );
}

/** `2026-03-20` → `Mar 20, 2026`. */
function fmtDay(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  );
}
