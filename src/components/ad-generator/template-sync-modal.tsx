'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { ApplyResult } from '@/lib/ad-generator/template-sync-apply';
import type { ChangeKind } from '@/lib/ad-generator/template-sync';

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

/** Ads per request — matches the cap on the sync route. */
const BATCH = 10;

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
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  const ids = includeExpired ? [...impact.activeIds, ...impact.expiredIds] : impact.activeIds;

  const apply = async () => {
    if (!ids.length) return;
    setBusy(true);
    setDone(0);
    const all: ApplyResult[] = [];
    try {
      // Chunked so each request stays inside its timeout and the user sees real
      // progress rather than one indefinite spinner — a template used by forty
      // ads is forty sequential Chromium renders.
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const res = await fetch(`/api/ad-generator/templates-doc/${impact.templateId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
        const json = (await res.json()) as { results?: ApplyResult[] };
        all.push(...(json.results ?? []));
        setDone(Math.min(i + BATCH, ids.length));
      }
      setResults(all);
      const updated = all.filter((r) => r.outcome === 'updated').length;
      const blocked = all.filter((r) => r.outcome === 'blocked').length;
      const failed = all.filter((r) => r.outcome === 'failed').length;
      if (blocked || failed) {
        toast.warning(
          `${updated} ad(s) updated · ${blocked + failed} kept their current design`,
        );
      } else {
        toast.success(`${updated} ad(s) updated`);
      }
    } catch (err) {
      toast.error(`Couldn't finish: ${err instanceof Error ? err.message : 'unknown error'}`);
      // Keep whatever landed — a partial run is still worth reporting, and the
      // ads that didn't take the change can be updated individually later.
      setResults(all.length ? all : null);
    } finally {
      setBusy(false);
    }
  };

  const problems = (results ?? []).filter((r) => r.outcome === 'blocked' || r.outcome === 'failed');

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={() => !busy && onClose()}
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
            disabled={busy}
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
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-xs text-[var(--muted-foreground)]">
              Re-rendering {done} of {ids.length}… each ad is re-checked against the manufacturer rules
              before it changes.
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
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-40"
              >
                Don&apos;t apply
              </button>
              <button
                onClick={apply}
                disabled={busy || !ids.length}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
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
