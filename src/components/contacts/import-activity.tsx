'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Collapse } from '@/components/ui/collapse';
import type { ContactImportRunDto } from '@/lib/contacts/import-runs';

/**
 * Contact imports run on the worker (see src/lib/contacts/import-job.ts), so
 * the person can leave the import page. This is where they see them: running
 * imports with a live progress bar, recently finished ones with their counts,
 * and the account's import history behind a toggle.
 */

const POLL_ACTIVE_MS = 3000;
/** Finished imports stay on the Contacts screen this long unless dismissed. */
const SHOW_FINISHED_FOR_MS = 24 * 3600 * 1000;
const DISMISSED_KEY = 'loomi.contactImports.dismissed';

function isActive(run: ContactImportRunDto): boolean {
  return (run.status === 'queued' || run.status === 'running') && !run.stalled;
}

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    // Only the newest few matter; the list is capped server-side at 20 anyway.
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-50)));
  } catch {
    // Storage blocked — dismissal just won't survive a reload.
  }
}

/** Poll one import until it finishes. Used by the import page right after commit. */
export function useImportRun(runId: string | null): ContactImportRunDto | null {
  const [run, setRun] = useState<ContactImportRunDto | null>(null);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/contacts/import/runs/${encodeURIComponent(runId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.run) {
          setRun(data.run as ContactImportRunDto);
          if (!isActive(data.run)) return;
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!cancelled) timer = setTimeout(tick, POLL_ACTIVE_MS);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  return run;
}

export function ImportActivity({
  accountKey,
  onImportFinished,
}: {
  accountKey: string;
  /** Called when an import this screen watched running has finished — refresh the table. */
  onImportFinished?: () => void;
}) {
  const [runs, setRuns] = useState<ContactImportRunDto[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [showHistory, setShowHistory] = useState(false);
  const activeIdsRef = useRef<Set<string>>(new Set());
  const onFinishedRef = useRef(onImportFinished);
  onFinishedRef.current = onImportFinished;

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const load = useCallback(async (): Promise<ContactImportRunDto[] | null> => {
    if (!accountKey) return null;
    try {
      const res = await fetch(`/api/contacts/import/runs?accountKey=${encodeURIComponent(accountKey)}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data.runs) ? (data.runs as ContactImportRunDto[]) : null;
    } catch {
      return null;
    }
  }, [accountKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    activeIdsRef.current = new Set();

    const tick = async () => {
      const next = await load();
      if (cancelled) return;
      if (next) {
        // Anything we saw running last time that isn't running now just finished.
        const nowActive = new Set(next.filter(isActive).map((r) => r.id));
        const finished = [...activeIdsRef.current].some((id) => !nowActive.has(id));
        activeIdsRef.current = nowActive;
        setRuns(next);
        if (finished) onFinishedRef.current?.();
        if (nowActive.size === 0) return;
      }
      timer = setTimeout(tick, POLL_ACTIVE_MS);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissed(next);
      return next;
    });
  };

  const now = Date.now();
  const visible = runs.filter((run) => {
    if (isActive(run)) return true;
    if (dismissed.has(run.id)) return false;
    const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(run.startedAt);
    return now - finishedAt < SHOW_FINISHED_FOR_MS;
  });

  if (runs.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {visible.map((run) => (
        <div key={run.id} className="animate-fade-in-up">
          <ImportRunCard run={run} onDismiss={isActive(run) ? undefined : () => dismiss(run.id)} />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        aria-expanded={showHistory}
      >
        <ChevronDownIcon
          className={`w-3.5 h-3.5 transition-transform duration-200 ${showHistory ? 'rotate-180' : ''}`}
        />
        Import history
      </button>
      <Collapse open={showHistory}>
        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
          {runs.map((run) => (
            <HistoryRow key={run.id} run={run} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

function statusLabel(run: ContactImportRunDto): string {
  if (run.stalled) return 'Stopped responding';
  switch (run.status) {
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return 'Importing';
    case 'done':
      return 'Finished';
    default:
      return 'Failed';
  }
}

function countsLine(run: ContactImportRunDto): string {
  const parts = [
    `${run.imported.toLocaleString()} new`,
    `${run.updated.toLocaleString()} updated`,
  ];
  if (run.skipped > 0) parts.push(`${run.skipped.toLocaleString()} skipped`);
  return parts.join(' · ');
}

export function ImportRunCard({
  run,
  onDismiss,
}: {
  run: ContactImportRunDto;
  onDismiss?: () => void;
}) {
  const [showIssues, setShowIssues] = useState(false);
  const active = isActive(run);
  const failed = run.status === 'failed' || run.stalled;
  const pct =
    run.totalRows > 0 ? Math.min(100, Math.round((run.processedRows / run.totalRows) * 100)) : 0;
  const name = run.fileName || 'CSV import';

  return (
    <div
      className={`rounded-xl border p-3 ${
        failed
          ? 'border-red-500/30 bg-red-500/5'
          : run.status === 'done'
            ? 'border-[var(--border)] bg-[var(--card)]'
            : 'border-[var(--primary)]/30 bg-[var(--primary)]/5'
      }`}
    >
      <div className="flex items-start gap-2">
        {active ? (
          <ArrowPathIcon className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-[var(--primary)]" />
        ) : failed ? (
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
        ) : (
          <CheckCircleIcon className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {statusLabel(run)} <span className="text-[var(--muted-foreground)] font-normal">· {name}</span>
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {active
              ? `${run.processedRows.toLocaleString()} of ${run.totalRows.toLocaleString()} rows · ${countsLine(run)}`
              : failed
                ? run.stalled
                  ? `Stopped at ${run.processedRows.toLocaleString()} of ${run.totalRows.toLocaleString()} rows. Re-importing the same file is safe — existing contacts are matched, not duplicated.`
                  : `${run.error || 'The import failed.'} ${run.processedRows.toLocaleString()} of ${run.totalRows.toLocaleString()} rows were handled; re-importing the same file is safe.`
                : `${countsLine(run)}${run.listId ? ` · ${run.listMembershipsAdded.toLocaleString()} added to the list` : ''}`}
          </div>
          {active && (
            <>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
                <div
                  className="h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
                You can keep working — you&apos;ll get a notification when it&apos;s done.
              </div>
            </>
          )}
          {run.issues.length > 0 && !active && (
            <>
              <button
                type="button"
                onClick={() => setShowIssues((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-expanded={showIssues}
              >
                <ChevronDownIcon
                  className={`w-3 h-3 transition-transform duration-200 ${showIssues ? 'rotate-180' : ''}`}
                />
                Why rows were skipped
              </button>
              <Collapse open={showIssues}>
                <ul className="mt-1 max-h-40 overflow-y-auto text-[11px] text-[var(--muted-foreground)] space-y-0.5">
                  {run.issues.map((issue, i) => (
                    <li key={`${issue.rowNumber}-${i}`}>
                      Row {issue.rowNumber}: {issue.reason}
                    </li>
                  ))}
                  {run.skipped > run.issues.length && (
                    <li>…and {(run.skipped - run.issues.length).toLocaleString()} more</li>
                  )}
                </ul>
              </Collapse>
            </>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ run }: { run: ContactImportRunDto }) {
  const failed = run.status === 'failed' || run.stalled;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-xs bg-[var(--card)]">
      <span className="flex-1 min-w-0 truncate">{run.fileName || 'CSV import'}</span>
      <span className="text-[var(--muted-foreground)] whitespace-nowrap">
        {new Date(run.startedAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>
      <span className="text-[var(--muted-foreground)] whitespace-nowrap hidden sm:inline">
        {run.totalRows.toLocaleString()} rows
      </span>
      <span
        className={`whitespace-nowrap ${
          failed ? 'text-red-400' : run.status === 'done' ? 'text-emerald-500' : 'text-[var(--primary)]'
        }`}
      >
        {run.status === 'done' ? countsLine(run) : statusLabel(run)}
      </span>
    </div>
  );
}
