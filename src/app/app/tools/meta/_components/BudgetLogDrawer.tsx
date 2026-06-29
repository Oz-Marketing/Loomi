'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon,
  ArrowRightCircleIcon,
  BanknotesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  LockClosedIcon,
  LockOpenIcon,
  PencilSquareIcon,
  PlusCircleIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { toast } from '@/lib/toast';
import { UserAvatar } from '@/components/user-avatar';
import type { DirectoryUser } from '@/lib/ad-pacer/types';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtSyncedAgo, budgetTypeColor, budgetTypeTint } from '@/lib/ad-pacer/helpers';
import { fmtPeriodLong } from '@/lib/ad-pacer/period';
import { Tooltip, inputClass } from '@/app/app/tools/_shared';

// Meta-only budget-log + change-log drawers (own /budget-log + /audit APIs).
// Split out of MetaAdsPlannerTool to shrink the file.
export interface AdSnapshot {
  adId: string;
  adName: string;
  budgetType: 'Daily' | 'Lifetime';
  budgetSource: 'base' | 'added' | 'split';
  budget: number;
  projected: number;
  actual: number | null;
  target: number | null;
  recDaily: number | null;
}

interface BudgetLogEntry {
  id: string;
  period: string;
  adsSnapshot: string; // JSON-encoded AdSnapshot[]
  note: string | null;
  authorUserId: string | null;
  createdAt: string;
}

function parseAdsSnapshot(raw: string): AdSnapshot[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AdSnapshot[]) : [];
  } catch {
    return [];
  }
}

// Mini snapshot table reused for both the live "current snapshot"
// preview and each entry in the history list. Mirrors the Summary tab
// columns at compact density.
function BudgetLogMiniTable({ rows }: { rows: AdSnapshot[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-3 text-center">
        No ads to snapshot.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {['Ad', 'Type', 'Budget', 'Projected', 'Actual', 'Target', 'Remaining'].map((h) => (
              <th
                key={h}
                className="px-1.5 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isLifetime = r.budgetType === 'Lifetime';
            return (
              <tr key={r.adId} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-1.5 py-1.5 text-[var(--foreground)] max-w-[140px] truncate">
                  {r.adName}
                </td>
                <td className="px-1.5 py-1.5">
                  <span
                    className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{
                      background: budgetTypeTint(r.budgetType),
                      color: budgetTypeColor(r.budgetType),
                    }}
                  >
                    {r.budgetType}
                  </span>
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums whitespace-nowrap"
                  style={{ color: budgetTypeColor(r.budgetType) }}
                >
                  {fmt(r.budget)}
                  <span className="ml-0.5 text-[8px] text-[var(--muted-foreground)]">
                    {isLifetime ? 'total' : '/day'}
                  </span>
                </td>
                <td className="px-1.5 py-1.5 tabular-nums text-[var(--foreground)]">
                  {fmt(r.projected)}
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums"
                  style={{
                    color: r.actual != null ? COLORS.lifetime : 'var(--muted-foreground)',
                    opacity: r.actual != null ? 1 : 0.6,
                  }}
                >
                  {r.actual != null ? fmt(r.actual) : '—'}
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums"
                  style={{
                    color: r.target != null ? 'var(--foreground)' : 'var(--muted-foreground)',
                    opacity: r.target != null ? 1 : 0.6,
                  }}
                >
                  {r.target != null ? fmt(r.target) : '—'}
                </td>
                {(() => {
                  // Remaining spend = target − actual. Positive = still to
                  // spend; negative (over target) shows red.
                  const remaining =
                    r.target != null ? r.target - (r.actual ?? 0) : null;
                  return (
                    <td
                      className="px-1.5 py-1.5 tabular-nums"
                      style={{
                        color:
                          remaining == null
                            ? 'var(--muted-foreground)'
                            : remaining < 0
                              ? COLORS.error
                              : COLORS.success,
                        opacity: remaining == null ? 0.6 : 1,
                      }}
                    >
                      {remaining != null ? fmt(remaining) : '—'}
                    </td>
                  );
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BudgetLogDrawer({
  accountKey,
  accountLabel,
  period,
  adsSnapshot,
  users,
  currentUserId,
  onClose,
}: {
  accountKey: string;
  accountLabel: string;
  period: string;
  // Live per-ad snapshot computed by the parent at render time. The
  // drawer captures this exact array when the user clicks Log.
  adsSnapshot: AdSnapshot[];
  users: DirectoryUser[];
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<BudgetLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  // Per-entry expand state — history is collapsed by default so the
  // drawer reads as a tidy list; click any entry to expand its full
  // per-ad snapshot.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const userMap = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/budget-log?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ entries: BudgetLogEntry[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLog = async () => {
    if (posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/budget-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          adsSnapshot,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      }
      const created = (await res.json()) as BudgetLogEntry;
      setEntries((prev) => [created, ...(prev ?? [])]);
      setNote('');
      toast.success('Budget logged');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer budget-log] post failed', err);
      toast.error('Could not log budget');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (logId: string) => {
    const prev = entries ?? [];
    setEntries(prev.filter((e) => e.id !== logId));
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/budget-log/${logId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer budget-log] delete failed', err);
      toast.error('Could not delete entry');
      setEntries(prev);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[640px] max-w-[calc(100vw-1.5rem)] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <ClipboardDocumentListIcon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Budget Log — {accountLabel}</span>
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Snapshots for {fmtPeriodLong(period)}. Captures per-ad budget, projected, actual, target, and rec. daily at the moment you log.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex-shrink-0"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Log-current panel — shows the live per-ad snapshot we'd
            capture if the user clicks Log right now, plus an optional
            note. */}
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--primary)]/5 flex-shrink-0 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
            Log current snapshot ({adsSnapshot.length} ad{adsSnapshot.length === 1 ? '' : 's'})
          </div>
          <BudgetLogMiniTable rows={adsSnapshot} />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleLog();
              }
            }}
            placeholder="Optional note (e.g. rebalanced after client call)…"
            rows={2}
            className={`${inputClass} w-full resize-none text-xs`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleLog}
              disabled={posting || adsSnapshot.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
            >
              <CheckIcon className="w-3.5 h-3.5" />
              {posting ? 'Logging…' : 'Log this budget'}
            </button>
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2">
            History
          </div>
          {error ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Could not load entries: {error}
            </div>
          ) : entries == null ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">
              No entries yet for this month. Log the first one above.
            </div>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0">
              {entries.map((entry) => {
                const isMine =
                  !!currentUserId && entry.authorUserId === currentUserId;
                const author = entry.authorUserId
                  ? userMap.get(entry.authorUserId)
                  : null;
                const stamp = new Date(entry.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                const rows = parseAdsSnapshot(entry.adsSnapshot);
                const expanded = expandedIds.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className={`rounded-lg border overflow-hidden ${
                      isMine
                        ? 'border-[var(--primary)]/40 bg-[var(--primary)]/12'
                        : 'border-[var(--border)] bg-[var(--card)]'
                    }`}
                  >
                    {/* Header row — toggle button on the left, delete on
                        the right (separate <button>s so nothing is nested). */}
                    <div className="flex justify-between items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(entry.id)}
                        aria-expanded={expanded}
                        aria-controls={`budget-log-body-${entry.id}`}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left rounded hover:bg-[var(--muted)]/30 transition-colors -mx-1 px-1 py-1"
                      >
                        {expanded ? (
                          <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
                        ) : (
                          <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
                        )}
                        {author && (
                          <UserAvatar
                            name={author.name}
                            email={author.email}
                            avatarUrl={author.avatarUrl}
                            size={28}
                            className={`w-7 h-7 rounded-full object-cover flex-shrink-0 border ${
                              isMine
                                ? 'border-[var(--primary)]/60'
                                : 'border-[var(--border)]'
                            }`}
                          />
                        )}
                        <div className="flex flex-col min-w-0 leading-tight">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isMine ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                            }`}
                          >
                            {author?.name ?? 'Unknown'}
                          </span>
                          <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                            {stamp} · {rows.length} ad{rows.length === 1 ? '' : 's'}
                            {entry.note && ' · has note'}
                          </span>
                        </div>
                      </button>
                      <Tooltip label="Delete" className="flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors p-1 rounded"
                        aria-label="Delete entry"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                      </Tooltip>
                    </div>

                    {/* Body — collapsed by default */}
                    {expanded && (
                      <div id={`budget-log-body-${entry.id}`} className="px-3 pb-3 border-t border-[var(--border)] pt-2">
                        <BudgetLogMiniTable rows={rows} />
                        {entry.note && (
                          <p className="m-0 mt-2 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
                            {entry.note}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Change log drawer (automatic audit history, Change 10) ────────────────
interface AuditEntryView {
  id: string;
  adId: string | null;
  adName: string | null;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  summary: string;
  groupId: string | null;
  authorName: string;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
}

// Distinct hue per action so the log reads at a glance.
const AUDIT_ACTION_COLORS: Record<string, string> = {
  budget_push: COLORS.added,
  edit: COLORS.daily,
  created: COLORS.success,
  deleted: COLORS.error,
  carryover: COLORS.lifetime,
  freeze: COLORS.warn,
  reopen: COLORS.split,
  sync: COLORS.lifetime,
};

const AUDIT_ACTION_ICONS: Record<string, typeof ClockIcon> = {
  budget_push: BanknotesIcon,
  edit: PencilSquareIcon,
  created: PlusCircleIcon,
  deleted: TrashIcon,
  carryover: ArrowRightCircleIcon,
  freeze: LockClosedIcon,
  reopen: LockOpenIcon,
  sync: ArrowPathIcon,
};

export function ChangeLogDrawer({
  accountKey,
  accountLabel,
  period,
  onClose,
}: {
  accountKey: string;
  accountLabel: string;
  period: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/audit?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ entries: AuditEntryView[] }>;
      })
      .then((data) => {
        if (!cancelled) setEntries(Array.isArray(data?.entries) ? data.entries : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group ids that contain a `sync` entry. Imports/syncs write a sync line
  // (plus, for imports, per-ad `created` lines under the same group), so any
  // entry in one of these groups originated from Meta and gets a Meta badge.
  const metaGroupIds = new Set(
    (entries ?? [])
      .filter((e) => e.action === 'sync' && e.groupId)
      .map((e) => e.groupId),
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="frost-heavy fixed right-3 top-3 bottom-3 w-[420px] max-w-[calc(100vw-1.5rem)] rounded-2xl flex flex-col overflow-hidden animate-slide-in-right">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
              <ClockIcon className="w-4 h-4" />
              Change log
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)] truncate">
              {accountLabel} · {fmtPeriodLong(period)} · automatic history
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar p-4">
          {error ? (
            <div className="text-xs text-[#ef4444] text-center py-8">{error}</div>
          ) : entries == null ? (
            <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
              No changes recorded yet this month.
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((e) => {
                const color = AUDIT_ACTION_COLORS[e.action] ?? 'var(--muted-foreground)';
                const ActionIcon = AUDIT_ACTION_ICONS[e.action] ?? ClockIcon;
                const isSystem = e.authorName === 'System';
                const isFromMeta =
                  e.action === 'sync' || (!!e.groupId && metaGroupIds.has(e.groupId));
                return (
                  <div
                    key={e.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{ background: `${color}22`, color }}
                        >
                          <ActionIcon className="w-3 h-3" />
                          {e.action.replace(/_/g, ' ')}
                        </span>
                        {isFromMeta && (
                          <Tooltip label="From Meta">
                          <span
                            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#0866FF]/15 text-[#0866FF]"
                          >
                            <MetaBrandIcon className="w-3 h-3" />
                            Meta
                          </span>
                          </Tooltip>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap">
                        {fmtSyncedAgo(e.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--foreground)] leading-snug">
                      {e.summary}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {!isSystem && (
                        <UserAvatar
                          name={e.authorName}
                          email={e.authorEmail}
                          avatarUrl={e.authorAvatarUrl}
                          size={18}
                          className="w-[18px] h-[18px] rounded-full object-cover border border-[var(--border)] flex-shrink-0"
                        />
                      )}
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {e.authorName}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
