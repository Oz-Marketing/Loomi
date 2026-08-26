'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { LINE_TYPES } from '@/lib/budget/channels';
import { useBudgetChannels } from '@/contexts/budget-channels-context';
import { jsonFetcher } from './fetcher';
import { usd0 } from './budget-shared';

type Group = {
  channel: string | null;
  lines: number;
  amount: number;
  examples: string[];
};

/**
 * Assign a line type to everything that still lacks one, a channel at a time.
 *
 * WHY BULK. Oz Reports had no concept of what KIND of money a line was, so
 * roughly 13% of the imported ledger came across untyped — and until a line is
 * typed its margin is unknown rather than zero. The decision is almost never
 * per line, though: everything on a channel is usually the same kind of money.
 * 738 lines of "Other" is not a job anyone does one row at a time.
 *
 * Only lines still marked unclassified are touched, so a decision someone
 * already made by hand in the drawer is never overruled, and re-running is
 * safe.
 *
 * The per-channel picker stays after saving, showing what it became, because
 * the useful feedback is "that's done" — not the row vanishing and leaving you
 * to remember what you just did.
 */
export function BudgetCategorizeModal({
  accountKey,
  year,
  accountName,
  onChanged,
  onClose,
}: {
  accountKey: string;
  year: number;
  accountName: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { channels: ch } = useBudgetChannels();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [done, setDone] = useState<Record<string, { lineType: string; lines: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const d = await jsonFetcher(
        `/api/budget/categorize?accountKey=${encodeURIComponent(accountKey)}&year=${year}`,
      );
      setGroups(d.groups);
    } catch {
      toast.error('Could not load what needs categorizing');
      setGroups([]);
    }
  }, [accountKey, year]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function apply(channel: string | null, lineType: string) {
    const key = channel ?? '';
    setBusy(key);
    try {
      const res = await fetch('/api/budget/categorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, year, channel, lineType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not categorize those lines');
      setDone((d) => ({ ...d, [key]: { lineType, lines: data.updated } }));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not categorize those lines');
    } finally {
      setBusy(null);
    }
  }

  if (!mounted) return null;

  const pending = (groups ?? []).filter((g) => !done[g.channel ?? '']);
  const totalPending = pending.reduce((t, g) => t + g.amount, 0);

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
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Categorize Budget</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {accountName} · {year}
              {pending.length > 0 && <> · {usd0(totalPending)} still untyped</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups == null ? (
            <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center">
              <CheckIcon className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
                Everything is categorized
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Every line for {year} has a type, so the margin figures are real.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                A type says what kind of money a line is, which is what makes margin computable —
                media costs amount × markup, a fee costs nothing, a service costs whatever the
                vendor invoiced. Setting one here applies it to every untyped line on that channel;
                anything already typed by hand is left alone.
              </p>

              <div className="space-y-2">
                {groups.map((g) => {
                  const key = g.channel ?? '';
                  const settled = done[key];
                  return (
                    <div
                      key={key}
                      className={`animate-fade-in-up rounded-xl border px-4 py-3 transition ${
                        settled
                          ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                          : 'border-[var(--border)] bg-[var(--muted)]/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
                            <ChannelIcon channel={g.channel} className="h-4 w-4 flex-shrink-0" />
                            {g.channel ? ch.label(g.channel) : 'No channel'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                            {g.lines} line{g.lines === 1 ? '' : 's'} · {usd0(g.amount)}
                            {/* Labels are often the only clue to what a
                                channel like "Other" actually holds. */}
                            {g.examples.length > 0 && (
                              <span className="opacity-70"> · {g.examples.join(', ')}</span>
                            )}
                          </p>
                        </div>

                        <div className="w-[190px] flex-shrink-0">
                          {settled ? (
                            <p className="flex items-center justify-end gap-1.5 pt-1 text-xs font-medium text-emerald-600">
                              <CheckIcon className="h-4 w-4" />
                              {settled.lines} → {typeLabel(settled.lineType)}
                            </p>
                          ) : (
                            <SearchableSelect
                              value=""
                              onChange={(v) => void apply(g.channel, v)}
                              searchable={false}
                              placeholder={busy === key ? 'Applying…' : 'Set the type…'}
                              options={LINE_TYPES.filter((t) => t.key !== 'unclassified').map(
                                (t) => ({ value: t.key, label: t.label }),
                              )}
                              className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function typeLabel(key: string) {
  return LINE_TYPES.find((t) => t.key === key)?.label ?? key;
}
