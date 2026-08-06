'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  XMarkIcon,
  RocketLaunchIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PlayIcon,
  PauseIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

/**
 * Publish an ad to Meta from inside Loomi.
 *
 * Three states, and they're deliberately distinct:
 *
 *   pick      → choose the ad set, see the campaign's special ad category
 *   blocked   → a checklist of what's missing, because every blocker here is a
 *               configuration gap someone can go and fix, not a bug
 *   published → created PAUSED, with the explicit Activate as its own step
 *
 * The paused-then-activate split is the whole risk posture: assembling the campaign
 * is the tedium worth automating, and starting to spend is the one act worth
 * keeping deliberate.
 */

interface AdSetOption {
  id: string;
  name: string;
  status: string;
  campaignId: string | null;
  campaignName: string | null;
  specialAdCategories: string[];
}

interface Blocker {
  field: string;
  reason: string;
}

/**
 * Where to go and fix each blocker.
 *
 * Every blocker here is a configuration gap rather than a fault, so the useful
 * thing to show alongside the reason is the screen that fixes it — otherwise the
 * reader is told what's wrong and left to search for where.
 */
const FIX_LOCATION: Record<string, string> = {
  metaAdAccountId: 'Sub-account → Integrations → Meta Ads',
  metaPageId: 'Sub-account → Integrations → Meta Ads → Publishing identity',
  destinationUrl: "The launch preset's URL template, or the sub-account's website",
  targetAdSetId: 'Pick an ad set above',
  copy: 'Open the ad and add copy, or re-run generation',
  specialAdCategories: 'Choose an ad set whose campaign carries the right category',
};

interface LaunchResult {
  launchId: string | null;
  status: 'published' | 'failed' | 'blocked';
  blockers: Blocker[];
  adSetId?: string | null;
  campaignId?: string | null;
  adIds?: Record<string, string>;
  pacerAdId?: string | null;
  error?: string;
  notices: string[];
}

export function LaunchModal({
  creativeId,
  adName,
  accountKey,
  onClose,
}: {
  creativeId: string;
  adName: string;
  accountKey: string;
  onClose: () => void;
}) {
  const [adSets, setAdSets] = useState<AdSetOption[] | null>(null);
  const [adSetsBlocked, setAdSetsBlocked] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [live, setLive] = useState<'ACTIVE' | 'PAUSED'>('PAUSED');

  // Ad sets + whatever target the preset already holds.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [setsRes, presetRes] = await Promise.all([
        fetch(`/api/ad-generator/launch/adsets/${encodeURIComponent(accountKey)}`).then((r) =>
          r.ok ? r.json() : { adSets: [], blocked: `HTTP ${r.status}` },
        ),
        fetch(`/api/ad-generator/launch-presets/${encodeURIComponent(accountKey)}?platform=meta`).then((r) =>
          r.ok ? r.json() : null,
        ),
      ]).catch(() => [{ adSets: [], blocked: 'Could not reach Loomi.' }, null]);
      if (cancelled) return;
      setAdSets(setsRes.adSets ?? []);
      setAdSetsBlocked(setsRes.blocked ?? null);
      if (presetRes?.preset?.targetAdSetId) setTargetId(presetRes.preset.targetAdSetId);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  /** Persist the target on the preset — a rooftop's ad set doesn't change monthly,
   *  so choosing it once should be enough. */
  const saveTarget = async (id: string) => {
    setTargetId(id);
    if (!id) return;
    setSavingTarget(true);
    try {
      const chosen = (adSets ?? []).find((a) => a.id === id);
      const res = await fetch(`/api/ad-generator/launch-presets/${encodeURIComponent(accountKey)}?platform=meta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchMode: 'attach_existing', targetAdSetId: id, targetAdSetName: chosen?.name ?? null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
    } catch (err) {
      toast.error(`Couldn't save the target: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSavingTarget(false);
    }
  };

  const launch = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const { result: r } = (await res.json()) as { result: LaunchResult };
      setResult(r);
      if (r.status === 'published') toast.success('Created on Meta — paused, ready for you to activate');
      else if (r.status === 'failed') toast.error(r.error ?? 'The launch failed');
    } catch (err) {
      toast.error(`Couldn't launch: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const setLiveStatus = async (next: 'ACTIVE' | 'PAUSED') => {
    if (!result?.launchId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/launch/${result.launchId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setLive(next);
      toast.success(next === 'ACTIVE' ? 'Live — this ad is now spending' : 'Paused');
    } catch (err) {
      toast.error(`Couldn't change status: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const chosen = (adSets ?? []).find((a) => a.id === targetId);
  const adsManagerUrl = result?.campaignId
    ? `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${result.campaignId}`
    : null;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && onClose()}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
              <RocketLaunchIcon className="h-4 w-4 text-[var(--primary)]" />
              Launch to Meta
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{adName}</p>
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
          {/* ── published ── */}
          {result?.status === 'published' && (
            <>
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                  <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                  Created on Meta — paused
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  Nothing is spending yet. Review it on Meta if you want, then activate.
                </p>
              </div>
              {result.pacerAdId && (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  A pacer budget line was created and linked to this ad set — no Discover/Import needed.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {live === 'PAUSED' ? (
                  <button
                    onClick={() => void setLiveStatus('ACTIVE')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <PlayIcon className="h-3.5 w-3.5" />
                    {busy ? 'Working…' : 'Activate — start spending'}
                  </button>
                ) : (
                  <button
                    onClick={() => void setLiveStatus('PAUSED')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
                  >
                    <PauseIcon className="h-3.5 w-3.5" />
                    Pause
                  </button>
                )}
                {adsManagerUrl && (
                  <a
                    href={adsManagerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                    Open in Ads Manager
                  </a>
                )}
              </div>
            </>
          )}

          {/* ── blocked: a checklist, not an error ── */}
          {result?.status === 'blocked' && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
                Not launched — nothing was created
              </div>
              <ul className="space-y-1.5">
                {result.blockers.map((b) => (
                  <li key={b.field} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px]">
                    <div className="text-[var(--foreground)]">{b.reason}</div>
                    {FIX_LOCATION[b.field] && (
                      <div className="mt-1 text-[var(--muted-foreground)]">
                        Fix in: <span className="font-medium">{FIX_LOCATION[b.field]}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result?.status === 'failed' && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[11px]">
              <div className="font-semibold text-[var(--foreground)]">Meta refused the publish</div>
              <div className="mt-0.5 text-[var(--muted-foreground)]">{result.error}</div>
              <div className="mt-1.5 text-[var(--muted-foreground)]">
                The attempt is recorded, so you can fix the cause and try again.
              </div>
            </div>
          )}

          {/* ── pick a target ── */}
          {!result && (
            <>
              {adSetsBlocked ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-[var(--muted-foreground)]">
                  {adSetsBlocked}
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-[var(--foreground)]">
                    Add this creative to
                  </span>
                  <select
                    value={targetId}
                    onChange={(e) => void saveTarget(e.target.value)}
                    disabled={busy || savingTarget || !adSets}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  >
                    <option value="">{adSets ? 'Choose an ad set…' : 'Loading…'}</option>
                    {(adSets ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.campaignName ? `${a.campaignName} › ${a.name}` : a.name}
                        {a.status !== 'ACTIVE' ? ` (${a.status.toLowerCase()})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
                    Adding to a running ad set keeps its learning and its budget — no new campaign. Saved for
                    this sub-account, so you only pick once.
                  </span>
                </label>
              )}

              {/* The category is the thing that decides whether this is even legal,
                  so it's shown before the button rather than discovered after it. */}
              {chosen && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-[11px]">
                  <div className="font-semibold text-[var(--foreground)]">
                    {chosen.campaignName ?? 'Campaign'}
                  </div>
                  <div className="mt-0.5 text-[var(--muted-foreground)]">
                    Special ad categories:{' '}
                    {chosen.specialAdCategories.length ? chosen.specialAdCategories.join(', ') : 'none'}
                  </div>
                  {chosen.specialAdCategories.length === 0 && (
                    <div className="mt-1 text-amber-600 dark:text-amber-400">
                      A lease or APR ad needs a campaign declared FINANCIAL_PRODUCTS_SERVICES. A campaign&apos;s
                      category can&apos;t be changed after it&apos;s created, so this one will be refused if the
                      offer is a financing offer.
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] text-[var(--muted-foreground)]">
                The ad is created <strong>paused</strong>. Activating is a separate click.
              </p>
            </>
          )}

          {result?.notices?.length ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Notes
              </div>
              <ul className="space-y-0.5">
                {result.notices.map((n, i) => (
                  <li key={i} className="text-[11px] text-[var(--muted-foreground)]">
                    · {n}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-40"
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={launch}
              disabled={busy || !targetId || !!adSetsBlocked}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
            >
              <RocketLaunchIcon className="h-3.5 w-3.5" />
              {busy ? 'Publishing…' : 'Create paused ad'}
            </button>
          )}
          {result?.status === 'blocked' && (
            <button
              onClick={() => setResult(null)}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
