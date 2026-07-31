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
  monthIndexOf,
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
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* frost-heavy, not bg-[var(--card)] — `--card` is 62% opaque by design
          for in-page surfaces, which makes a floating panel unreadable over
          the grid behind it. */}
      <div className="frost-heavy relative flex h-full w-full max-w-md flex-col overflow-y-auto shadow-xl">
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
              {line.channel && isPacedChannel(line.channel) && line.period && (
                <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                  Feeds the Ad Pacer&apos;s <strong>{line.bucket}</strong> budget for{' '}
                  {line.period} when that month is budget-managed.
                </p>
              )}
            </div>

            {/* Provenance */}
            <div className="space-y-1.5 text-xs">
              <Row label="Source" value={line.source} />
              <Row label="Pacer bucket" value={line.bucket} />
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
                    options={EDITABLE_STATUSES.map((s) => ({ value: s, label: s }))}
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
