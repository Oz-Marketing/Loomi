'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { ApplyResult } from '@/lib/ad-generator/template-sync-apply';
import type { ChangeKind } from '@/lib/ad-generator/template-sync';
import type { SyncRunStatus } from '@/app/api/ad-generator/templates-doc/[id]/sync/route';

/**
 * "You changed a template. N ads were built from it. Apply the change?"
 *
 * Shown after a template save when ads are following that template. Deliberately
 * not a yes/no: it reports which ads can take the update, splits them by whether
 * the offer behind them is still running, and says whether the edit is cosmetic
 * or moved the data contract — because those change the right answer.
 *
 * Customized ads are counted and never included. Their whole point is that they
 * diverged on purpose; sweeping them up here would make "customize" meaningless.
 */

export interface SyncImpact {
  templateId: string;
  change: { kind: ChangeKind; reasons: string[] } | null;
  total: number;
  truncated: boolean;
  counts: { active: number; expired: number; customized: number; upToDate: number; ready: number };
  activeIds: string[];
  expiredIds: string[];
}

/** Does this impact warrant asking at all? */
export function shouldPromptSync(impact: SyncImpact | null): boolean {
  if (!impact) return false;
  if (impact.change?.kind === 'none') return false;
  return impact.counts.active + impact.counts.expired > 0;
}

/** How often to ask the run how it's going. */
const POLL_MS = 1500;

export function TemplateSyncModal({
  impact,
  templateName,
  onClose,
}: {
  impact: SyncImpact;
  templateName: string;
  onClose: () => void;
}) {
  const structural = impact.change?.kind === 'structural';
  // Expired offers are excluded by default: re-rendering an ad whose offer has
  // ended rewrites history and buys nothing.
  //
  // Unless they're all there is. That rule exists to keep pointless work out of a
  // run that has real work in it; with no running ad to update it turns the whole
  // dialog into "Apply to 0 ads", which is a dead end, not a default.
  const [includeExpired, setIncludeExpired] = useState(
    impact.counts.active === 0 && impact.counts.expired > 0,
  );
  const [busy, setBusy] = useState(false);
  // STATE, not a ref. The poll below is keyed on this, and a ref would not
  // re-render — so the effect ran once while the id was still null, bailed out,
  // and the dialog sat on "0 of 24" through a run that had already finished.
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<SyncRunStatus | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  const ids = includeExpired ? [...impact.activeIds, ...impact.expiredIds] : impact.activeIds;

  /**
   * Start the run. The work happens on the worker — see the route — so this
   * only hands over the ad list and gets back a run id to follow.
   */
  const apply = async () => {
    if (!ids.length) return;
    setBusy(true);
    setRun(null);
    setRunId(null);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${impact.templateId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const json = (await res.json()) as { runId?: string };
      if (!json.runId) throw new Error('The update did not start');
      setRunId(json.runId);
    } catch (err) {
      setBusy(false);
      toast.error(`Couldn't start: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  // Follow the run until it lands. Deliberately re-armed with a timeout rather
  // than an interval, so a slow response can never stack up overlapping polls.
  useEffect(() => {
    if (!busy || !runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/ad-generator/templates-doc/${impact.templateId}/sync?runId=${encodeURIComponent(runId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const status = (await res.json()) as SyncRunStatus;
        if (cancelled) return;
        setRun(status);
        if (status.status === 'done' || status.status === 'failed') {
          setResults(status.results);
          setBusy(false);
          if (status.status === 'failed') {
            toast.error(`Couldn't finish: ${status.error || 'unknown error'}`);
          } else if (status.blocked || status.failed) {
            toast.warning(
              `${status.updated} ad(s) updated · ${status.blocked + status.failed} kept their current design`,
            );
          } else {
            toast.success(`${status.updated} ad(s) updated`);
          }
          return;
        }
      } catch {
        // A dropped poll is not a failed run — the worker is still going. Try
        // again on the next tick rather than declaring the whole thing broken.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    // Ask immediately as well as on the interval: a short run can be finished
    // before the first tick, and waiting to say so looks like nothing happened.
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, runId, impact.templateId]);

  const problems = (results ?? []).filter((r) => r.outcome === 'blocked' || r.outcome === 'failed');
  const done = run?.processed ?? 0;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">
              {results ? 'Update finished' : 'Apply this change to existing ads?'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {results ? (
                <>What happened to the ads built from &ldquo;{templateName}&rdquo;.</>
              ) : (
                <>
                  &ldquo;{templateName}&rdquo; is saved. {impact.total} ad(s) were built from it — ads that
                  follow the template can take your change now.
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {!results && (
            <>
              {/* What kind of change this is — the thing that decides whether
                  applying is routine or needs thought. */}
              {impact.change && (
                <div
                  className={`rounded-xl border p-3 ${
                    structural
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-[var(--border)] bg-[var(--muted)]/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground)]">
                    {structural && <ExclamationTriangleIcon className="h-3.5 w-3.5 text-amber-500" />}
                    {structural ? 'Structural change' : 'Cosmetic change'}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {structural
                      ? 'This edit moved what the design asks for, not just how it looks. Existing ads may not have values for it — check a couple after applying.'
                      : 'Layout and styling only. Existing ads still fit the design, so applying is safe.'}
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {impact.change.reasons.slice(0, 6).map((r, i) => (
                      <li key={i} className="text-[11px] text-[var(--muted-foreground)]">
                        · {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Who is affected. */}
              <div className="space-y-1.5 text-xs text-[var(--foreground)]">
                <Row
                  count={impact.counts.active}
                  label="follow the template, offer still running"
                  emphasis
                />
                <Row count={impact.counts.expired} label="follow the template, but the offer has ended" />
                <Row count={impact.counts.customized} label="have been customized — these are never touched" />
                <Row count={impact.counts.upToDate} label="already have this design" />
              </div>

              {impact.counts.expired > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] p-3">
                  <input
                    type="checkbox"
                    checked={includeExpired}
                    onChange={(e) => setIncludeExpired(e.target.checked)}
                    disabled={busy}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Also update the {impact.counts.expired} ad(s) whose offer has already ended.
                  </span>
                </label>
              )}

              {impact.counts.ready > 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {impact.counts.ready} of these are marked <strong>ready</strong>. Any that can&apos;t take
                  the change without failing preflight will be put back to draft for review.
                </p>
              )}

              {impact.truncated && (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Showing the {impact.activeIds.length + impact.expiredIds.length + impact.counts.customized + impact.counts.upToDate}{' '}
                  most recently updated of {impact.total} ads. Run this again to reach the rest.
                </p>
              )}
            </>
          )}

          {busy && (
            <div className="animate-fade-in-up space-y-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-xs text-[var(--muted-foreground)]">
              <div>
                {run?.status === 'queued'
                  ? `Queued ${ids.length} ad(s)…`
                  : `Re-rendering ${done} of ${run?.total ?? ids.length}…`}{' '}
                each ad is re-checked against the manufacturer rules before it changes.
              </div>
              {/* Height-animated in the same way as every other progress bar in
                  the app; see globals.css. */}
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.round((done / Math.max(1, run?.total ?? ids.length)) * 100)}%` }}
                />
              </div>
              <div>This runs in the background. You can close this and carry on working.</div>
              {run?.stalled && (
                <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {done > 0
                      ? `This has not moved past ${done} for a while. Whatever did not make it can be updated from the ad itself.`
                      : 'Nothing has picked this up yet. It will start on its own once background processing is back.'}
                  </span>
                </div>
              )}
            </div>
          )}

          {results && (
            <div className="space-y-2">
              <div className="text-xs text-[var(--foreground)]">
                {results.filter((r) => r.outcome === 'updated').length} updated ·{' '}
                {problems.length} kept their current design
              </div>
              {problems.length > 0 && (
                <ul className="space-y-1.5">
                  {problems.map((r) => (
                    <li
                      key={r.creativeId}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px]"
                    >
                      <div className="font-semibold text-[var(--foreground)]">
                        {r.name || r.creativeId}
                        {r.demoted && ' — put back to draft'}
                      </div>
                      <div className="mt-0.5 text-[var(--muted-foreground)]">{r.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-4">
          {results ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                {busy ? 'Close' : "Don't apply"}
              </button>
              <button
                onClick={apply}
                disabled={busy || !ids.length}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
              >
                {busy ? 'Applying…' : `Apply to ${ids.length} ad${ids.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One count line. Zero rows are dropped rather than shown as "0 ads". */
function Row({ count, label, emphasis }: { count: number; label: string; emphasis?: boolean }) {
  if (!count) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`min-w-[1.5rem] text-right font-semibold ${
          emphasis ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
        }`}
      >
        {count}
      </span>
      <span className="text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}
