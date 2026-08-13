'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { RIGHTS_STATUS_LABELS, type RightsStatus } from '@/lib/media-rights';
import { toast } from '@/lib/toast';

/**
 * Rights activity — the sweep's job history plus what it found.
 *
 * Health first, because the question a heartbeat answers is "can I trust the
 * rest of this page?" A stale sweep means the expiry data below it is stale too,
 * and that has to be visible before anyone acts on the list.
 */

interface Health {
  lastRunAt: string | null;
  lastRunError: string | null;
  hoursSinceLastRun: number | null;
  state: 'ok' | 'stale' | 'error' | 'never';
  staleAfterHours: number;
}

interface Run {
  id: string;
  accountKey: string | null;
  startedAt: string;
  scanned: number;
  expiredCount: number;
  warnedCount: number;
  error: string | null;
}

interface Attention {
  id: string;
  filename: string;
  accountKey: string | null;
  oem: string | null;
  status: string;
  rightsStatus: RightsStatus;
  daysRemaining: number | null;
  urgent: boolean;
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const HEALTH_COPY: Record<Health['state'], { tone: string; label: string }> = {
  ok: { tone: 'text-emerald-400', label: 'Sweep healthy' },
  stale: { tone: 'text-amber-400', label: 'Sweep may have stopped' },
  error: { tone: 'text-red-400', label: 'Last sweep failed' },
  never: { tone: 'text-[var(--muted-foreground)]', label: 'Sweep has never run' },
};

export function RightsActivityPanel() {
  const [data, setData] = useState<{
    health: Health;
    runs: Run[];
    attention: Attention[];
    attentionTruncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  /**
   * Download the rights sheet.
   *
   * Lives on this panel rather than the grid because this is where a rights
   * review starts — the question "what's lapsing and what's already gone" is
   * the one the file answers.
   */
  const exportCsv = useCallback(async (datedOnly: boolean) => {
    setExporting(true);
    try {
      const res = await fetch('/api/media/rights-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: 'all', datedOnly }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Could not build the export');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loomi-rights-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const count = res.headers.get('X-Row-Count');
      toast.success(`Exported ${count ?? ''} asset${count === '1' ? '' : 's'}`.replace('  ', ' '));
      if (res.headers.get('X-Truncated')) {
        toast.error('Export was capped at 5000 rows — narrow the scope for the rest.');
      }
    } catch {
      toast.error('Could not build the export');
    }
    setExporting(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/media/rights-activity');
      if (res.ok) setData(await res.json());
    } catch {
      /* leave the panel empty rather than breaking the page */
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <p className="text-xs text-[var(--muted-foreground)]">Loading…</p>;
  }
  if (!data) {
    return <p className="text-xs text-[var(--muted-foreground)]">Rights activity is unavailable.</p>;
  }

  const { health, runs, attention } = data;
  const copy = HEALTH_COPY[health.state];
  const urgent = attention.filter((a) => a.urgent);

  return (
    <div className="space-y-5">
      {/* ── Health ── */}
      <div className="rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {health.state === 'ok' ? (
              <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <ExclamationTriangleIcon className={`mt-0.5 h-5 w-5 shrink-0 ${copy.tone}`} />
            )}
            <div>
              <p className={`text-sm font-semibold ${copy.tone}`}>{copy.label}</p>
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                {health.lastRunAt
                  ? `Last ran ${relative(health.lastRunAt)}. Runs daily at 07:30 UTC.`
                  : 'No run has been recorded yet. It runs daily at 07:30 UTC once deployed.'}
              </p>
              {health.state === 'stale' && (
                <p className="mt-1 text-[11px] leading-snug text-amber-400">
                  Nothing recorded in over {health.staleAfterHours} hours, so the expiry
                  data below may be out of date.
                </p>
              )}
              {health.lastRunError && (
                <p className="mt-1 font-mono text-[10px] leading-snug text-red-400">
                  {health.lastRunError}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Two exports because they answer different questions: the licensed
                set is the review, everything is the audit including the gaps. */}
            <button
              type="button"
              onClick={() => exportCsv(true)}
              disabled={exporting}
              title="Only assets that carry a licence or campaign date"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              {exporting ? 'Exporting…' : 'Export rights'}
            </button>
            <button
              type="button"
              onClick={() => exportCsv(false)}
              disabled={exporting}
              title="Every asset, including those with no licence recorded"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              All
            </button>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Needs attention ── */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">Needs attention</h3>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {attention.length === 0
              ? 'nothing expiring or expired'
              : `${attention.length} asset${attention.length === 1 ? '' : 's'}${
                  urgent.length > 0 ? ` · ${urgent.length} approved and out of licence` : ''
                }`}
          </span>
        </div>

        {attention.length === 0 ? (
          <p className="rounded-lg border border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
            No asset is expiring within 30 days or past its date.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {/* Urgent first — an approved asset that has lapsed is exposure, not
                housekeeping, and it should not be buried behind sorting. */}
            {[...attention].sort((a, b) => Number(b.urgent) - Number(a.urgent)).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
              >
                {a.urgent && (
                  <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--foreground)]">
                    {a.filename}
                  </p>
                  <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                    {a.accountKey ?? (a.oem ? `${a.oem} (shared)` : 'Loomi (global)')}
                    {a.status === 'approved' ? ' · approved' : ' · draft'}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    a.rightsStatus === 'expiring_soon'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {a.rightsStatus === 'expiring_soon' && a.daysRemaining !== null
                    ? `${a.daysRemaining}d left`
                    : RIGHTS_STATUS_LABELS[a.rightsStatus]}
                </span>
              </div>
            ))}
          </div>
        )}
        {data.attentionTruncated && (
          <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
            Showing the first 200 dated assets — there may be more.
          </p>
        )}
      </div>

      {/* ── Run history ── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Run history</h3>
        {runs.length === 0 ? (
          <p className="rounded-lg border border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
            No runs recorded yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-[var(--border)] bg-[var(--muted)]/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <span>Run</span>
              <span className="text-right">Scanned</span>
              <span className="text-right">Expired</span>
              <span className="text-right">Warned</span>
            </div>
            {runs.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-[var(--border)] px-3 py-1.5 text-xs last:border-b-0"
              >
                <span className="min-w-0 truncate text-[var(--muted-foreground)]">
                  {relative(r.startedAt)}
                  {r.accountKey ? ` · ${r.accountKey}` : ''}
                  {r.error && <span className="ml-1.5 text-red-400">failed</span>}
                </span>
                <span className="text-right tabular-nums text-[var(--muted-foreground)]">{r.scanned}</span>
                <span className={`text-right tabular-nums ${r.expiredCount > 0 ? 'text-red-400' : 'text-[var(--muted-foreground)]'}`}>
                  {r.expiredCount}
                </span>
                <span className={`text-right tabular-nums ${r.warnedCount > 0 ? 'text-amber-400' : 'text-[var(--muted-foreground)]'}`}>
                  {r.warnedCount}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted-foreground)]">
          A run with zero scanned is normal — it means the sweep ran and nothing was
          due. The row existing is the point: without it, a job that stopped would
          look the same as a quiet one.
        </p>
      </div>
    </div>
  );
}
