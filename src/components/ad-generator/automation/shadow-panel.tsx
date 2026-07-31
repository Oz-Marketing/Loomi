'use client';

/**
 * The automation panel — everything about one sub-account's autonomous ads.
 *
 * Reads top to bottom as a single story: is it on and healthy → what it's set
 * to do → what it found → what it built. The three questions it exists to
 * answer, before anything runs unattended:
 *   1. Is inventory fresh, and did the feed change shape? (feed staleness)
 *   2. Does each on-lot model actually have an advertisable offer, and is the
 *      OEM's cycle current or lapsed? (match rate + cycle state)
 *   3. How far ahead does each OEM really publish? (measured lead time)
 *
 * The "would choose" column is the policy's verdict recorded for inspection,
 * deliberately not acted on — generation is a separate, explicit step.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowPathIcon,
  CheckCircleIcon,

  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { HelpTip } from '@/components/ui/help-tip';

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

const WINDOW_LABEL: Record<string, string> = {
  next_month: 'next month',
  current_month: 'this month',
  rolling: 'the next 30 days',
};

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── shared chrome ────────────────────────────────────────────────────────────

/** Every block on the page uses this, so the headings stop competing. */
function Card({
  title,
  help,
  count,
  children,
}: {
  title: string;
  help?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]">
            {count}
          </span>
        )}
        {help && <HelpTip title={title} iconClassName="h-3.5 w-3.5">{help}</HelpTip>}
      </div>
      {children}
    </section>
  );
}

/**
 * A labelled field. Explanatory text goes in the HelpTip rather than trailing
 * the label — the labels used to carry "— blank = all", "— 0 = don't check" and
 * the like, which made every row a different width and buried the field name.
 */
function Field({
  label,
  help,
  className = '',
  children,
}: {
  label: string;
  help?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-[11px] font-medium text-[var(--muted-foreground)]">{label}</label>
        {help && <HelpTip title={label} iconClassName="h-3 w-3">{help}</HelpTip>}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

function Stat({
  label,
  value,
  sub,
  tone = 'default',
  help,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'warn';
  help?: React.ReactNode;
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : 'text-[var(--foreground)]';
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 flex items-center gap-1">
        <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
        {help && <HelpTip title={label} iconClassName="h-3 w-3">{help}</HelpTip>}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

// ── settings form ────────────────────────────────────────────────────────────

/** The editable config, held as one object so "has anything changed" is one compare. */
interface ScopeForm {
  makes: string;
  focus: string;
  exclude: string;
  zip: string;
  windowMode: string;
  templateId: string;
  sizeIds: string[];
  maxAds: string;
  minStock: string;
  mode: string;
}

const BLANK_FORM: ScopeForm = {
  makes: '',
  focus: '',
  exclude: '',
  zip: '',
  windowMode: 'next_month',
  templateId: '',
  sizeIds: [],
  maxAds: '10',
  minStock: '0',
  mode: 'draft',
};

function formFromReport(rep: ShadowReport): ScopeForm {
  return {
    makes: rep.scope?.makes?.join(', ') ?? '',
    focus: rep.scope?.focusModels?.join(', ') ?? '',
    exclude: rep.scope?.excludeModels?.join(', ') ?? '',
    zip: rep.scope?.zip ?? '',
    windowMode: rep.runWindow?.mode ?? 'next_month',
    templateId: rep.scope?.templateMap?.all ?? '',
    sizeIds: rep.scope?.sizeIds ?? [],
    maxAds: String(rep.scope?.maxAdsPerRun ?? 10),
    minStock: String(rep.scope?.minStock ?? 0),
    mode: rep.scope?.mode ?? 'draft',
  };
}

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function toPayload(f: ScopeForm) {
  return {
    makes: csv(f.makes),
    focusModels: csv(f.focus),
    excludeModels: csv(f.exclude),
    zip: f.zip.trim(),
    runWindowMode: f.windowMode,
    templateMap: f.templateId ? { all: f.templateId } : {},
    sizeIds: f.sizeIds,
    maxAdsPerRun: Number(f.maxAds) || 10,
    minStock: Number(f.minStock) || 0,
    mode: f.mode,
  };
}

/** Order-insensitive on sizeIds, so re-picking the same sizes isn't "dirty". */
const formKey = (f: ScopeForm) => JSON.stringify({ ...f, sizeIds: [...f.sizeIds].sort() });

/**
 * Which slice of the panel to show. The page owns the tab bar; the status strip
 * and its run-now actions render on all of them, because "is it on" and "run it
 * now" are questions you have regardless of which table you're reading.
 */
export type AutomationView = 'overview' | 'inventory' | 'drafts' | 'runs' | 'settings';

export function ShadowPanel({ accountKey, view }: { accountKey: string | null; view: AutomationView }) {
  const [report, setReport] = useState<ShadowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');

  // `form` is what's on screen; `saved` is what the server last confirmed. The
  // difference is what the Save button acts on — and what lets the enable/pause
  // toggle post the SAVED config instead of silently committing a half-typed edit.
  const [form, setForm] = useState<ScopeForm>(BLANK_FORM);
  const [saved, setSaved] = useState<ScopeForm>(BLANK_FORM);
  const dirty = formKey(form) !== formKey(saved);

  const set = <K extends keyof ScopeForm>(key: K, value: ScopeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const load = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ad-generator/automation/shadow?accountKey=${encodeURIComponent(accountKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const rep = json as ShadowReport;
      setReport(rep);
      const next = formFromReport(rep);
      setForm(next);
      setSaved(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the automation report');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

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
          toast.success(`Polled ${json.scopes} vehicle(s): ${json.offersNew} new, ${json.offersEnded} ended`);
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

  const templates = report?.templates ?? [];
  const templateSizes = templates.find((t) => t.id === form.templateId)?.sizes ?? [];
  const drafts = useMemo(() => report?.drafts ?? [], [report]);

  /**
   * Warnings that landed on EVERY draft describe the environment, not the ad —
   * "no S3 bucket", "no brand colour set". Repeating them on eight cards buried
   * the one note that was actually about a specific ad, so they're hoisted into
   * a single banner and removed from the cards below.
   */
  const sharedNotes = useMemo(() => {
    if (drafts.length < 2) return new Set<string>();
    const counts = new Map<string, number>();
    for (const d of drafts) for (const n of new Set(d.reviewNotes)) counts.set(n, (counts.get(n) ?? 0) + 1);
    return new Set([...counts].filter(([, c]) => c === drafts.length).map(([n]) => n));
  }, [drafts]);

  if (!accountKey) {
    return (
      <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Pick a sub-account to see its automation.</p>
      </div>
    );
  }

  const t = report?.totals;
  const state = !report?.configured ? 'not configured' : report.enabled ? 'watching' : 'paused';
  const templateName = templates.find((x) => x.id === form.templateId)?.name;

  /** One-line recap of the config, so the collapsed card still says what it does. */
  const summary = [
    form.makes.trim() || 'all makes',
    form.focus.trim() || 'every model with stock',
    templateName ?? 'no template',
    form.sizeIds.length ? `${form.sizeIds.length} size${form.sizeIds.length === 1 ? '' : 's'}` : 'all sizes',
    `up to ${form.maxAds}/run`,
    form.mode === 'ready' ? 'publish-ready' : 'drafts',
  ].join(' · ');

  return (
    <div className="space-y-5">
      {/* ── status + run actions ── */}
      <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Automation</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  state === 'watching'
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : state === 'paused'
                      ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}
              >
                {state}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {report ? (
                <>
                  Watching inventory and OEM offers, planning for{' '}
                  <span className="text-[var(--foreground)]">{WINDOW_LABEL[report.runWindow.mode] ?? report.runWindow.mode}</span>{' '}
                  ({report.runWindow.start} → {report.runWindow.end}). Ads are built only when you generate them.
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => act('save_config', { enabled: !report?.enabled, ...toPayload(saved) }, 'toggle')}
              disabled={!!busy}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
            >
              {report?.enabled ? 'Pause' : 'Enable'}
            </button>
            {/* Run-now actions, grouped so they read as one cluster distinct
                from the on/off switch beside them. */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-1">
              <button
                onClick={() => act('sync_feeds')}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/60 disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${busy === 'sync_feeds' ? 'animate-spin' : ''}`} />
                Sync inventory
              </button>
              <button
                onClick={() => act('poll_offers')}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/60 disabled:opacity-50"
              >
                {busy === 'poll_offers' ? (
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayIcon className="h-3.5 w-3.5" />
                )}
                Poll offers
              </button>
            </div>
            <button
              onClick={() => act('generate')}
              disabled={!!busy}
              title="Renders draft ads from the offers on file. Nothing publishes."
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'generate' ? (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SparklesIcon className="h-3.5 w-3.5" />
              )}
              Generate drafts
            </button>
          </div>
        </div>

        {/* Environment problems affecting every generated ad. */}
        {view === 'overview' && sharedNotes.size > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
              Affects every generated ad
            </div>
            <ul className="mt-1.5 space-y-1">
              {[...sharedNotes].map((n) => (
                <li key={n} className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}

        {view === 'overview' && t && (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="new units on lot" value={String(t.newUnits)} sub={`${t.stockGroups} model groups`} />
            <Stat
              label="have a usable offer"
              value={`${t.matchRatePct}%`}
              sub={`${t.groupsWithOffer} of ${t.stockGroups} groups`}
              tone={t.matchRatePct >= 70 ? 'good' : 'warn'}
              help={<p>Share of on-lot model groups with an OEM offer valid for the run window. The rest can&apos;t be advertised until the manufacturer publishes something.</p>}
            />
            <Stat label="live offers on file" value={String(t.liveOffers)} />
            <Stat
              label="awaiting next OEM cycle"
              value={String(t.awaitingNextCycle)}
              tone={t.awaitingNextCycle > 0 ? 'warn' : 'default'}
              help={<p>Programmes that expire before the run window opens, where the manufacturer hasn&apos;t published the next cycle yet. A wait state, not a failure.</p>}
            />
          </div>
        )}
      </section>

      {/* ── settings ── */}
      {view === 'settings' && (
      <section className="glass-card rounded-2xl border border-[var(--border)]">
        <div className="flex items-center gap-3 p-5 pb-0">
          <Cog6ToothIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              Settings
              {dirty && (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                  unsaved
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">{summary}</p>
          </div>
        </div>

        <div className="mt-5 space-y-5 px-5 pb-5">
            {/* What to advertise */}
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                What to advertise
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Makes" help={<p>Comma-separated. Leave blank to watch <strong>every make</strong> the inventory feed reports.</p>}>
                  <input value={form.makes} onChange={(e) => set('makes', e.target.value)} placeholder="Chevrolet" className={inputClass} />
                </Field>
                <Field label="Focus models" help={<p>Only advertise these. Leave blank for <strong>every model with stock</strong>.</p>}>
                  <input value={form.focus} onChange={(e) => set('focus', e.target.value)} placeholder="Silverado 1500, Equinox" className={inputClass} />
                </Field>
                <Field label="Exclude models" help={<p>Never advertise these, even when they have stock and a live offer.</p>}>
                  <input value={form.exclude} onChange={(e) => set('exclude', e.target.value)} placeholder="Bolt EV" className={inputClass} />
                </Field>
                <Field label="Min stock" help={<p>Skip a model unless at least this many new units are on the lot. <strong>0 turns the check off.</strong></p>}>
                  <input value={form.minStock} onChange={(e) => set('minStock', e.target.value.replace(/[^0-9]/g, ''))} className={inputClass} />
                </Field>
              </div>
            </div>

            {/* How ads are built */}
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                How ads are built
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Template" help={<p>The design every generated ad uses. <strong>Required</strong> — with none mapped, generation skips every vehicle.</p>}>
                  <select value={form.templateId} onChange={(e) => set('templateId', e.target.value)} className={inputClass}>
                    <option value="">Not mapped — generation will skip</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                        {tpl.owned ? '' : ' (shared)'}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Output" help={<p><strong>Draft</strong> holds every ad for a person to approve. <strong>Ready</strong> publishes automatically, but only for makes with a verified co-op pack.</p>}>
                  <select value={form.mode} onChange={(e) => set('mode', e.target.value)} className={inputClass}>
                    <option value="draft">Draft — a person approves</option>
                    <option value="ready">Ready — needs verified co-op</option>
                  </select>
                  {/* A dial that silently does nothing is worse than no dial —
                      `ready` falls back to `draft` per-ad without a verified pack. */}
                  {form.mode === 'ready' && (
                    <p className="mt-1.5 flex gap-1 text-[10px] text-amber-500">
                      <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>
                        Ads still land as drafts for any make without a <strong>verified</strong> co-op pack — no
                        packs are on file yet, so this currently changes nothing.
                      </span>
                    </p>
                  )}
                </Field>

                {/* Sizes come from the SELECTED template's own list rather than a
                    fixed set: sizes are a property of the design, so offering one
                    the template doesn't define would just render nothing. */}
                {form.templateId && templateSizes.length > 0 && (
                  <Field
                    label="Sizes"
                    help={<p>Which of the template&apos;s sizes to render. Select none to render <strong>all {templateSizes.length}</strong>.</p>}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {templateSizes.map((sz) => {
                        const on = form.sizeIds.length === 0 || form.sizeIds.includes(sz.id);
                        return (
                          <button
                            key={sz.id}
                            type="button"
                            onClick={() =>
                              set(
                                'sizeIds',
                                (() => {
                                  const cur = form.sizeIds;
                                  // First click on an "all" state means "just this
                                  // one", which is what narrowing down wants.
                                  if (cur.length === 0) return [sz.id];
                                  const next = cur.includes(sz.id) ? cur.filter((x) => x !== sz.id) : [...cur, sz.id];
                                  // Deselecting the last returns to all, rather
                                  // than leaving a config that renders nothing.
                                  return next.length === templateSizes.length ? [] : next;
                                })(),
                              )
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
                  </Field>
                )}
              </div>
            </div>

            {/* Timing and limits */}
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Timing &amp; limits
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Plan for" help={<p>The window an offer has to cover to be advertisable. Most OEMs publish month by month, so <strong>next month</strong> is the usual choice.</p>}>
                  <select value={form.windowMode} onChange={(e) => set('windowMode', e.target.value)} className={inputClass}>
                    <option value="next_month">Next month</option>
                    <option value="current_month">This month</option>
                    <option value="rolling">Rolling 30 days</option>
                  </select>
                </Field>
                <Field label="Max ads per run" help={<p>Ceiling on how many ads one generate produces, so a feed change can&apos;t flood the review queue.</p>}>
                  <input value={form.maxAds} onChange={(e) => set('maxAds', e.target.value.replace(/[^0-9]/g, ''))} className={inputClass} />
                </Field>
                <Field label="ZIP" help={<p>Where OEM offers are looked up. Regional incentives differ by market, so this should be the dealership&apos;s own ZIP.</p>}>
                  <input value={form.zip} onChange={(e) => set('zip', e.target.value)} placeholder="84401" className={inputClass} />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
              {dirty && (
                <button
                  onClick={() => setForm(saved)}
                  disabled={!!busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Discard changes
                </button>
              )}
              <button
                onClick={() => act('save_config', { enabled: report?.enabled ?? false, ...toPayload(form) }, 'save')}
                disabled={!!busy || !dirty}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
        </div>
      </section>
      )}

      {/* ── feeds + the watch list they feed ── */}
      {view === 'inventory' && (
      <>
      <Card
        title="Inventory feeds"
        count={report?.feeds.length}
        help={<p>The dealership&apos;s Vehicle Listing Ads export. It supplies on-lot stock, which decides what&apos;s worth advertising and gates generation on real availability.</p>}
      >
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

        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
          <Field label="Name" className="min-w-[140px] flex-1">
            <input value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="Young Chev" className={inputClass} />
          </Field>
          <Field label="Feed URL" className="min-w-[240px] flex-[3]">
            <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://ozreports.com/feed/vla/…" className={inputClass} />
          </Field>
          <button
            onClick={async () => {
              await act('add_feed', { url: feedUrl, name: feedName }, 'add_feed');
              setFeedUrl('');
              setFeedName('');
            }}
            disabled={!!busy || !feedUrl.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-[7px] text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Add feed
          </button>
        </div>
      </Card>

      {/* ── watched vehicles ── */}
      <Card
        title="Watched vehicles"
        count={report?.vehicles.length}
        help={
          <>
            <p><strong>What each column means:</strong></p>
            <ul>
              <li><strong>Stock</strong> — new units of that model on the lot right now.</li>
              <li><strong>Live</strong> — manufacturer offers currently valid for it.</li>
              <li><strong>Ended</strong> — offers that have since expired.</li>
              <li><strong>Cycle</strong> — whether those offers cover the window you&apos;re planning for.</li>
              <li><strong>Last ends</strong> — when the latest one runs out.</li>
              <li><strong>Would choose</strong> — the offer the policy would put on an ad, if you generated one now.</li>
            </ul>
            <p>The list builds itself. Anything with new stock in the feed and inside your Settings scope lands here — there&apos;s nothing to add by hand.</p>
          </>
        }
      >
        {/* Connor asked what this section even was. It's the join between the
            two feeds, and saying so plainly beats another tooltip. */}
        <p className="-mt-1 mb-3 max-w-3xl text-xs leading-relaxed text-[var(--muted-foreground)]">
          Your on-lot inventory matched against the manufacturer offers polled for it — what you have to sell,
          next to what the OEM is currently paying to advertise. A model can only produce an ad when it appears
          here with stock <em>and</em> a live offer. Nothing here is acted on: <strong>Would choose</strong> is the
          decision recorded for inspection, so you can check the automation&apos;s judgement before trusting it.
        </p>
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
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.className}`} title={c.hint}>
                          {c.label}
                        </span>
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
      </Card>
      </>
      )}

      {/* ── generated drafts (the review queue) ── */}
      {view === 'drafts' && (
        drafts.length === 0 ? (
          <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">Nothing generated yet.</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Use <strong>Generate drafts</strong> above to build ads from the offers on file.
            </p>
          </div>
        ) : (
        <Card
          title="Generated drafts"
          count={drafts.length}
          help={<p>Machine-built and waiting on a person — nothing here has published. A <strong>no co-op check</strong> badge means no manufacturer rules were on file for that brand, so none were evaluated.</p>}
        >
          <div className="space-y-2">
            {drafts.map((d) => {
              const expired = d.expiresAt ? new Date(d.expiresAt).getTime() < Date.now() : false;
              const notes = d.reviewNotes.filter((n) => !sharedNotes.has(n));
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
                    {notes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {notes.map((n, i) => (
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
        </Card>
        )
      )}

      {/* ── measured OEM lead time ── */}
      {view === 'overview' && report?.leadTimes.length ? (
        <Card
          title="Measured publication lead time"
          help={
            <>
              <p>Days between first seeing a programme and its expiry.</p>
              <p>
                Measured, not assumed — testing found Honda publishing ~6 weeks out while Mazda and GM published
                only to month-end, so a single hardcoded assumption would be wrong for most brands.
              </p>
              <p>Accuracy improves as history accumulates.</p>
            </>
          }
        >
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
        </Card>
      ) : null}

      {/* ── run history / heartbeat ── */}
      {view === 'runs' && (
      <Card
        title="Run history"
        help={<p>Every run is recorded, including ones that changed nothing — otherwise a stalled job looks identical to a quiet month.</p>}
      >
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
                  ) : r.kind === 'generate' ? (
                    /* A generate run counts VEHICLE GROUPS in `scopesChecked` and
                       never sets `vehiclesSeen`, so the feed-sync labels below
                       read "8 feeds · 0 vehicles" — wrong on every column. */
                    <>
                      <span className="text-[var(--foreground)]">{r.scopesChecked} vehicles</span>
                      <span>{r.offersSeen} offers</span>
                      {r.issueCount > 0 && <span className="text-amber-500">{r.issueCount} skipped</span>}
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
      </Card>
      )}

      {loading && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-3 w-3 animate-spin" /> Refreshing…
        </p>
      )}
    </div>
  );
}
