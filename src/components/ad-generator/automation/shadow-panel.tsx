'use client';

/**
 * Shadow-mode panel — the Phase 1 watch surface.
 *
 * Answers the three questions Phase 1 exists to answer, before anything
 * generates unattended:
 *   1. Is inventory fresh, and did the feed change shape? (feed staleness)
 *   2. Does each on-lot model actually have an advertisable offer, and is the
 *      OEM's cycle current or lapsed? (match rate + cycle state)
 *   3. How far ahead does each OEM really publish? (measured lead time)
 *
 * Nothing here creates an ad. The "would choose" column is the policy's verdict
 * recorded for inspection, deliberately not acted on.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

interface FeedStatus {
  id: string;
  name: string;
  url: string;
  storeCode: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  vehicleCount: number;
  newVehicleCount: number;
  ageHours: number | null;
  stale: boolean;
}

type CycleState = 'none' | 'current' | 'partial' | 'expiring_unrenewed' | 'undated' | 'unwatched';

interface WatchedVehicle {
  year: number;
  make: string;
  model: string;
  stock: number;
  liveOffers: number;
  endedOffers: number;
  cycleState: CycleState;
  cycleSummary: string;
  latestEnd: string | null;
  wouldChoose: string | null;
  firstSeenAt: string | null;
}

interface LeadTimeStat {
  make: string;
  median: number;
  min: number;
  max: number;
  n: number;
}

interface RunSummary {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  scopesChecked: number;
  offersSeen: number;
  offersNew: number;
  offersEnded: number;
  vehiclesSeen: number;
  issueCount: number;
  error: string | null;
}

interface ShadowScope {
  makes: string[];
  focusModels: string[];
  excludeModels: string[];
  zip: string | null;
  templateMap: Record<string, string>;
  /** Size ids to render; empty = every size the template defines. */
  sizeIds: string[];
  radius: number;
  maxAdsPerRun: number;
  minStock: number;
  offerTypePriority: string[];
  mode: string;
}

interface GeneratedDraft {
  id: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  coopCheckedVersion: string | null;
  expiresAt: string | null;
  reviewNotes: string[];
  updatedAt: string;
}

interface ShadowReport {
  accountKey: string;
  configured: boolean;
  enabled: boolean;
  scope: ShadowScope;
  templates: { id: string; name: string; owned: boolean; sizes: { id: string; label: string }[] }[];
  drafts: GeneratedDraft[];
  runWindow: { start: string; end: string; mode: string };
  feeds: FeedStatus[];
  vehicles: WatchedVehicle[];
  leadTimes: LeadTimeStat[];
  runs: RunSummary[];
  totals: {
    newUnits: number;
    stockGroups: number;
    groupsWithOffer: number;
    matchRatePct: number;
    liveOffers: number;
    awaitingNextCycle: number;
  };
}

/** Cycle-state presentation. `expiring_unrenewed` is amber, NOT red: the OEM
 *  simply hasn't published next month yet, which is a wait state rather than a
 *  failure — conflating the two is exactly the mistake this panel prevents. */
const CYCLE: Record<CycleState, { label: string; className: string; hint: string }> = {
  current: { label: 'Current', className: 'bg-emerald-500/15 text-emerald-500', hint: 'Covers the whole run window' },
  partial: { label: 'Partial', className: 'bg-blue-500/15 text-blue-500', hint: 'Expires partway through the window' },
  expiring_unrenewed: {
    label: 'Awaiting next cycle',
    className: 'bg-amber-500/15 text-amber-500',
    hint: 'Programmes expire before the window opens — the OEM has not published the next cycle',
  },
  undated: { label: 'No end date', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]', hint: 'Timing cannot be assessed' },
  none: { label: 'No programmes', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]', hint: 'The OEM publishes nothing for this vehicle' },
  unwatched: { label: 'Never polled', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]', hint: 'No offer history yet' },
};

function Stat({ label, value, tone = 'default', hint }: { label: string; value: string; tone?: 'default' | 'good' | 'warn'; hint?: string }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : 'text-[var(--foreground)]';
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3" title={hint}>
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ShadowPanel({ accountKey }: { accountKey: string | null }) {
  const [report, setReport] = useState<ShadowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');
  // Watch scope. Blank makes = watch every make the inventory reports, which is
  // the zero-config default; blank models = every model with stock.
  const [makes, setMakes] = useState('');
  const [focus, setFocus] = useState('');
  const [zip, setZip] = useState('');
  const [windowMode, setWindowMode] = useState('next_month');
  // Which template generation aims at. Empty = unmapped, and the resolver will
  // refuse rather than pick something arbitrary.
  const [templateId, setTemplateId] = useState('');
  /** Empty = render every size the template defines. */
  const [sizeIds, setSizeIds] = useState<string[]>([]);
  const [exclude, setExclude] = useState('');
  const [maxAds, setMaxAds] = useState('10');
  const [minStock, setMinStock] = useState('0');
  const [mode, setMode] = useState('draft');

  const load = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ad-generator/automation/shadow?accountKey=${encodeURIComponent(accountKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const rep = json as ShadowReport;
      setReport(rep);
      // Mirror the saved scope into the inputs so edits start from the truth.
      setMakes(rep.scope?.makes?.join(', ') ?? '');
      setFocus(rep.scope?.focusModels?.join(', ') ?? '');
      setZip(rep.scope?.zip ?? '');
      setWindowMode(rep.runWindow?.mode ?? 'next_month');
      setTemplateId(rep.scope?.templateMap?.all ?? '');
      setSizeIds(rep.scope?.sizeIds ?? []);
      setExclude(rep.scope?.excludeModels?.join(', ') ?? '');
      setMaxAds(String(rep.scope?.maxAdsPerRun ?? 10));
      setMinStock(String(rep.scope?.minStock ?? 0));
      setMode(rep.scope?.mode ?? 'draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the shadow report');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  /** The scope fields, sent with every config save so a toggle can't wipe them. */
  const scopePayload = useCallback(
    () => ({
      makes: csv(makes),
      focusModels: csv(focus),
      zip: zip.trim(),
      runWindowMode: windowMode,
      templateMap: templateId ? { all: templateId } : {},
      sizeIds,
      excludeModels: csv(exclude),
      maxAdsPerRun: Number(maxAds) || 10,
      minStock: Number(minStock) || 0,
      mode,
    }),
    [makes, focus, zip, windowMode, templateId, sizeIds, exclude, maxAds, minStock, mode],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}, label = action) => {
      if (!accountKey) return;
      setBusy(label);
      try {
        const res = await fetch('/api/ad-generator/automation/shadow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountKey, action, ...extra }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (action === 'sync_feeds') {
          const bad = (json.feeds ?? []).filter((f: { status: string }) => f.status !== 'ok');
          toast[bad.length ? 'warning' : 'success'](
            bad.length
              ? `${bad.length} of ${json.feeds.length} feed(s) had problems`
              : `Synced ${json.feeds.length} feed(s)`,
          );
        } else if (action === 'poll_offers') {
          toast.success(
            `Polled ${json.scopes} vehicle(s): ${json.offersNew} new, ${json.offersEnded} ended`,
          );
        } else if (action === 'generate') {
          const skipped = (json.skipped ?? []).length;
          toast[json.created || json.refreshed ? 'success' : 'warning'](
            json.created || json.refreshed
              ? `${json.created} new draft(s), ${json.refreshed} refreshed${skipped ? `, ${skipped} skipped` : ''}`
              : `No ads generated — ${skipped} vehicle(s) skipped. See the skip reasons below.`,
          );
        } else {
          toast.success('Saved');
        }
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [accountKey, load],
  );

  if (!accountKey) {
    return (
      <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Pick a sub-account to see its shadow report.</p>
      </div>
    );
  }

  const t = report?.totals;

  return (
    <div className="space-y-5">
      {/* ── status + actions ── */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Shadow mode
              {report && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    report.enabled
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                  }`}
                >
                  {report.configured ? (report.enabled ? 'watching' : 'configured, paused') : 'not configured'}
                </span>
              )}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Records offer history and inventory. Creates no ads.
              {report && (
                <>
                  {' '}Planning for{' '}
                  <span className="text-[var(--foreground)]">
                    {report.runWindow.start} → {report.runWindow.end}
                  </span>{' '}
                  ({report.runWindow.mode.replace('_', ' ')}).
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => act('save_config', { enabled: !report?.enabled, ...scopePayload() }, 'toggle')}
              disabled={!!busy}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
            >
              {report?.enabled ? 'Pause watching' : 'Enable watching'}
            </button>
            <button
              onClick={() => act('sync_feeds')}
              disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
            >
              {busy === 'sync_feeds' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <ArrowPathIcon className="h-3.5 w-3.5" />}
              Sync inventory
            </button>
            <button
              onClick={() => act('poll_offers')}
              disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
            >
              {busy === 'poll_offers' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <PlayIcon className="h-3.5 w-3.5" />}
              Poll offers now
            </button>
            <button
              onClick={() => act('generate')}
              disabled={!!busy}
              title="Renders draft ads from the offers on file. Nothing publishes."
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'generate' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="h-3.5 w-3.5" />}
              Generate drafts
            </button>
          </div>
        </div>

        {/* ── watch scope ── */}
        <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-1">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Makes <span className="font-normal">— blank = all</span>
            </label>
            <input
              value={makes}
              onChange={(e) => setMakes(e.target.value)}
              placeholder="Chevrolet"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Focus models <span className="font-normal">— blank = every model with stock</span>
            </label>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Silverado 1500, Equinox"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">ZIP</label>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="84401"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Template <span className="font-normal">— required to generate</span>
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            >
              <option value="">Not mapped — generation will skip</option>
              {(report?.templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.owned ? '' : ' (shared)'}
                </option>
              ))}
            </select>

            {/* Sizes. Driven by the SELECTED template's own list rather than a
                fixed set, because sizes are a property of the design — offering
                one the template doesn't define would just render nothing. */}
            {(() => {
              const sizes = report?.templates?.find((t) => t.id === templateId)?.sizes ?? [];
              if (!templateId || sizes.length === 0) return null;
              const all = sizeIds.length === 0;
              return (
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                    Sizes to generate{' '}
                    <span className="font-normal">— none selected means all {sizes.length}</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {sizes.map((sz) => {
                      const on = all || sizeIds.includes(sz.id);
                      return (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() =>
                            setSizeIds((cur) => {
                              // First click on an "all" state means "just this one",
                              // which is what someone narrowing down actually wants.
                              if (cur.length === 0) return [sz.id];
                              const next = cur.includes(sz.id)
                                ? cur.filter((x) => x !== sz.id)
                                : [...cur, sz.id];
                              // Deselecting the last one returns to all, rather than
                              // leaving a config that renders nothing.
                              return next.length === sizes.length ? [] : next;
                            })
                          }
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            on
                              ? 'bg-[var(--primary)] text-white'
                              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                          }`}
                        >
                          {sz.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Plan for</label>
            <div className="flex gap-1.5">
              <select
                value={windowMode}
                onChange={(e) => setWindowMode(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                <option value="next_month">Next month</option>
                <option value="current_month">This month</option>
                <option value="rolling">Rolling 30d</option>
              </select>
              <button
                onClick={() => act('save_config', { enabled: report?.enabled ?? false, ...scopePayload() }, 'save_scope')}
                disabled={!!busy}
                className="flex-shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* ── generation limits + autonomy dial ── */}
        <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Exclude models
            </label>
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="Bolt EV"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Max ads per run
            </label>
            <input
              value={maxAds}
              onChange={(e) => setMaxAds(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Min stock <span className="font-normal">— 0 = don’t check</span>
            </label>
            <input
              value={minStock}
              onChange={(e) => setMinStock(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Output</label>
            <div className="flex gap-1.5">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                <option value="draft">Draft — a person approves</option>
                <option value="ready">Ready — needs verified co-op</option>
              </select>
              <button
                onClick={() => act('save_config', { enabled: report?.enabled ?? false, ...scopePayload() }, 'save_limits')}
                disabled={!!busy}
                className="flex-shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {/* State the precondition inline. A dial that silently does nothing is
                worse than no dial — `ready` falls back to `draft` per-ad without a
                verified pack, and the reason lands in that ad's review notes. */}
            {mode === 'ready' && (
              <p className="mt-1.5 flex gap-1 text-[10px] text-amber-500">
                <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>
                  Ads still land as drafts for any make without a <strong>verified</strong> co-op pack — no
                  packs are on file yet, so this currently changes nothing.
                </span>
              </p>
            )}
          </div>
        </div>

        {t && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="new units on lot" value={String(t.newUnits)} />
            <Stat label="year/make/model groups" value={String(t.stockGroups)} />
            <Stat
              label="with a usable offer"
              value={`${t.groupsWithOffer}/${t.stockGroups}`}
              tone={t.matchRatePct >= 70 ? 'good' : 'warn'}
            />
            <Stat
              label="match rate"
              value={`${t.matchRatePct}%`}
              tone={t.matchRatePct >= 70 ? 'good' : 'warn'}
              hint="On-lot models with an offer valid for the run window"
            />
            <Stat label="live offers on file" value={String(t.liveOffers)} />
            <Stat
              label="awaiting next OEM cycle"
              value={String(t.awaitingNextCycle)}
              tone={t.awaitingNextCycle > 0 ? 'warn' : 'default'}
              hint="Programmes expire before the run window and the OEM has not published the next cycle"
            />
          </div>
        )}
      </div>

      {/* ── feeds ── */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Inventory feeds
        </h2>
        {report?.feeds.length ? (
          <div className="mb-4 space-y-2">
            {report.feeds.map((f) => (
              <div
                key={f.id}
                className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                  f.stale ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--card)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {f.lastSyncStatus === 'ok' && !f.stale ? (
                      <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                    ) : f.lastSyncStatus === 'error' ? (
                      <XCircleIcon className="h-4 w-4 flex-shrink-0 text-red-500" />
                    ) : (
                      <ClockIcon className="h-4 w-4 flex-shrink-0 text-amber-500" />
                    )}
                    <span className="truncate text-sm font-medium text-[var(--foreground)]">{f.name}</span>
                    {f.storeCode && (
                      <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {f.storeCode}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                    <span>{f.vehicleCount} vehicles</span>
                    <span className="text-[var(--foreground)]">{f.newVehicleCount} new</span>
                    <span>synced {relTime(f.lastSyncedAt)}</span>
                  </div>
                  {f.lastSyncMessage && (
                    <p className="mt-1 break-words text-[11px] text-[var(--muted-foreground)]">{f.lastSyncMessage}</p>
                  )}
                </div>
                <button
                  onClick={() => act('remove_feed', { feedId: f.id }, `rm-${f.id}`)}
                  disabled={!!busy}
                  aria-label={`Remove ${f.name}`}
                  className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-xs text-[var(--muted-foreground)]">
            No feeds yet. Add a Vehicle Listing Ads URL below — the parser reads the Google/Meta VLA CSV schema.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Name</label>
            <input
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              placeholder="Young Chev"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="min-w-[240px] flex-[3]">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Feed URL</label>
            <input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://ozreports.com/feed/vla/…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <button
            onClick={async () => {
              await act('add_feed', { url: feedUrl, name: feedName }, 'add_feed');
              setFeedUrl('');
              setFeedName('');
            }}
            disabled={!!busy || !feedUrl.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Add feed
          </button>
        </div>
      </div>

      {/* ── watched vehicles ── */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Watched vehicles
        </h2>
        {report?.vehicles.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-2 py-2 font-medium">Vehicle</th>
                  <th className="px-2 py-2 text-right font-medium">Stock</th>
                  <th className="px-2 py-2 text-right font-medium">Live</th>
                  <th className="px-2 py-2 text-right font-medium">Ended</th>
                  <th className="px-2 py-2 font-medium">Cycle</th>
                  <th className="px-2 py-2 font-medium">Last ends</th>
                  <th className="px-2 py-2 font-medium">Would choose</th>
                </tr>
              </thead>
              <tbody>
                {report.vehicles.map((v) => {
                  const c = CYCLE[v.cycleState] ?? CYCLE.unwatched;
                  return (
                    <tr
                      key={`${v.year}-${v.make}-${v.model}`}
                      className="border-b border-[var(--border)]/50 last:border-0"
                      title={v.cycleSummary}
                    >
                      <td className="px-2 py-2 text-[var(--foreground)]">
                        {v.year} {v.make} {v.model}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--muted-foreground)]">
                        {v.stock || '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--foreground)]">{v.liveOffers}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--muted-foreground)]">
                        {v.endedOffers || '—'}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.className}`}>{c.label}</span>
                      </td>
                      <td className="px-2 py-2 tabular-nums text-[var(--muted-foreground)]">{v.latestEnd ?? '—'}</td>
                      <td className="px-2 py-2 text-[var(--foreground)]">{v.wouldChoose ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">
            Nothing watched yet. Sync inventory, then poll offers — the watch list builds itself from on-lot new stock.
          </p>
        )}
      </div>

      {/* ── generated drafts (the review queue) ── */}
      {report?.drafts.length ? (
        <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Generated drafts
          </h2>
          <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
            Machine-built and waiting on a person. Nothing here has published. A blank co-op column means no
            manufacturer rules were checked for that brand.
          </p>
          <div className="space-y-2">
            {report.drafts.map((d) => {
              const expired = d.expiresAt ? new Date(d.expiresAt).getTime() < Date.now() : false;
              return (
                <div
                  key={d.id}
                  className={`flex flex-wrap items-start gap-3 rounded-xl border px-3 py-2.5 ${
                    expired ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--border)] bg-[var(--card)]'
                  }`}
                >
                  {d.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.thumbnailUrl}
                      alt=""
                      className="h-12 w-12 flex-shrink-0 rounded border border-[var(--border)] bg-white object-contain"
                    />
                  ) : (
                    <div className="h-12 w-12 flex-shrink-0 rounded border border-dashed border-[var(--border)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/ad-generator/${d.id}`}
                        className="truncate text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline"
                      >
                        {d.name}
                      </Link>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          d.status === 'ready'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {d.status}
                      </span>
                      {d.coopCheckedVersion ? (
                        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-500">
                          co-op {d.coopCheckedVersion}
                        </span>
                      ) : (
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500"
                          title="No co-op pack was on file for this make, so no manufacturer advertising rules were evaluated."
                        >
                          no co-op check
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--muted-foreground)]">
                      <span>built {relTime(d.updatedAt)}</span>
                      {d.expiresAt && (
                        <span className={expired ? 'text-red-500' : ''}>
                          {expired ? 'offer expired ' : 'offer ends '}
                          {d.expiresAt.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    {d.reviewNotes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {d.reviewNotes.map((n, i) => (
                          <li key={i} className="flex gap-1.5 text-[11px] text-amber-500">
                            <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                            <span className="break-words">{n}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── measured OEM lead time ── */}
      {report?.leadTimes.length ? (
        <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Measured publication lead time
          </h2>
          <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
            Days between first seeing a programme and its expiry. Measured, not assumed — testing found Honda
            publishing ~6 weeks out while Mazda and GM published only to month-end, so a single hardcoded
            assumption would be wrong for most brands. Accuracy improves as history accumulates.
          </p>
          <div className="flex flex-wrap gap-3">
            {report.leadTimes.map((l) => (
              <div key={l.make} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                <div className="text-sm font-medium text-[var(--foreground)]">{l.make}</div>
                <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  median <span className="text-[var(--foreground)]">{l.median}d</span> · {l.min}–{l.max}d · n={l.n}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── run history / heartbeat ── */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Run history
        </h2>
        <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
          Every run is recorded, including ones that changed nothing — otherwise a stalled job looks identical to a
          quiet month.
        </p>
        {report?.runs.length ? (
          <div className="space-y-1.5">
            {report.runs.map((r) => (
              <div
                key={r.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                  r.error ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-medium text-[var(--muted-foreground)]">
                    {r.kind.replace('_', ' ')}
                  </span>
                  <span className="text-[var(--muted-foreground)]">{relTime(r.startedAt)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-[var(--muted-foreground)]">
                  {r.kind === 'offer_poll' ? (
                    <>
                      <span>{r.scopesChecked} scopes</span>
                      <span>{r.offersSeen} seen</span>
                      <span className="text-[var(--foreground)]">{r.offersNew} new</span>
                      <span>{r.offersEnded} ended</span>
                    </>
                  ) : (
                    <>
                      <span>{r.scopesChecked} feeds</span>
                      <span className="text-[var(--foreground)]">{r.vehiclesSeen} vehicles</span>
                      {r.issueCount > 0 && <span className="text-amber-500">{r.issueCount} issues</span>}
                    </>
                  )}
                </div>
                {r.error && (
                  <p className="w-full break-words text-red-500">
                    <ExclamationTriangleIcon className="mr-1 inline h-3 w-3" />
                    {r.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No runs yet.</p>
        )}
      </div>

      {loading && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-3 w-3 animate-spin" /> Refreshing…
        </p>
      )}
    </div>
  );
}
