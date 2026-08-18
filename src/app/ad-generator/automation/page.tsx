'use client';

/**
 * Automation dry run (admin) — the inspector for the autonomous ad pipeline.
 *
 * Runs the full chain for one vehicle and shows what happened at every step:
 * which offers MarketCheck returned, which one the policy chose AND WHY, the
 * fields that were filled, the disclaimer source, the preflight verdict, and
 * the rendered PNGs.
 *
 * Nothing is written — no creative, no upload, no offer state. This is the
 * surface for watching each phase of the build land, so it reads as a trace
 * rather than a tool.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  PlayIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { Select, type SelectOption } from '@/components/select';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from '@/components/ad-generator/client-form/evox-makes';
import { ShadowPanel, type AutomationView } from '@/components/ad-generator/automation/shadow-panel';
import { ClientTemplateCard } from '@/components/ad-generator/automation/client-template-card';
import { useAutomation, type Automation } from '@/components/ad-generator/automation/use-automation';

type Status = 'ok' | 'warn' | 'failed' | 'skipped';

interface Step {
  id: string;
  label: string;
  status: Status;
  ms: number;
  summary: string;
  detail?: unknown;
}

interface Preview {
  sizeId: string;
  label: string;
  width: number;
  height: number;
  dataUrl: string;
}

interface DryRunResult {
  ok: boolean;
  steps: Step[];
  previews: Preview[];
}

interface TemplateOption {
  id: string;
  name: string;
}

const OFFER_TYPES = [
  { value: 'lease', label: 'Lease' },
  { value: 'apr', label: 'APR' },
  { value: 'cash', label: 'Cash' },
] as const;

// Config leads, where Overview used to. Overview's own panels weren't deleted
// with the tab — the at-a-glance stats and the "affects every generated ad"
// warnings now render above the tab strip on every view, because a warning that
// every ad is broken should not be reachable only by picking the right tab.
const TABS = [
  ['settings', 'Config'],
  ['inventory', 'Inventory'],
  ['drafts', 'Generated drafts'],
  ['runs', 'Run history'],
  ['dryrun', 'Dry run'],
] as const;

const STATUS_STYLE: Record<Status, { icon: typeof CheckCircleIcon; className: string; ring: string }> = {
  ok: { icon: CheckCircleIcon, className: 'text-emerald-500', ring: 'border-emerald-500/30 bg-emerald-500/5' },
  warn: { icon: ExclamationTriangleIcon, className: 'text-amber-500', ring: 'border-amber-500/30 bg-amber-500/5' },
  failed: { icon: XCircleIcon, className: 'text-red-500', ring: 'border-red-500/30 bg-red-500/5' },
  skipped: { icon: MinusCircleIcon, className: 'text-[var(--muted-foreground)]', ring: 'border-[var(--border)]' },
};

/**
 * A JSON detail block with a copy button that appears on hover.
 *
 * The button lives in a wrapper rather than inside the `<pre>` so it stays pinned
 * while the content scrolls. Uses a NAMED group (`group/copy`) so an ancestor's
 * hover state can't trigger it. Also revealed on keyboard focus — a hover-only
 * control is unreachable without a pointer.
 */
function CopyableDetail({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). Say so
      // rather than showing a success state for something that didn't happen.
      toast.error('Could not copy — clipboard access was blocked');
    }
  };

  return (
    <div className="group/copy relative border-t border-[var(--border)]">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy JSON to clipboard'}
        title={copied ? 'Copied' : 'Copy JSON'}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 text-[10px] font-medium text-[var(--muted-foreground)] opacity-0 shadow-sm transition-opacity hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover/copy:opacity-100"
      >
        {copied ? (
          <>
            <CheckIcon className="h-3 w-3 text-emerald-500" /> Copied
          </>
        ) : (
          <ClipboardDocumentIcon className="h-3 w-3" />
        )}
      </button>
      <pre className="max-h-80 overflow-auto bg-[var(--muted)]/20 px-4 py-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        {json}
      </pre>
    </div>
  );
}

/**
 * The on/off switch for unattended runs.
 *
 * A real switch rather than a Pause/Enable button: this is a persistent state
 * you glance at, not a command you issue, and the button phrasing made you read
 * the label to work out which way round it was.
 */
function AutomationSwitch({ automation }: { automation: Automation }) {
  const { report, busy, toggleEnabled } = automation;
  const on = !!report?.enabled;
  const configured = !!report?.configured;

  return (
    <div className="flex items-center gap-2.5">
      <div className="text-right">
        <div className="text-xs font-medium text-[var(--foreground)]">
          {on ? 'Automation on' : 'Automation off'}
        </div>
        <div className="text-[11px] text-[var(--muted-foreground)]">
          {!configured ? 'Not set up yet' : on ? 'Watching for new offers' : 'Nothing runs on a schedule'}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Automation"
        onClick={() => void toggleEnabled()}
        disabled={!!busy || !report}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          on ? 'bg-[var(--primary)]' : 'bg-[var(--muted)] border border-[var(--border)]'
        }`}
      >
        <span
          className={`absolute top-1/2 h-4.5 w-4.5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
            on ? 'left-[1.55rem]' : 'left-1'
          }`}
          style={{ height: '1.125rem', width: '1.125rem' }}
        />
      </button>
    </div>
  );
}

export default function AutomationDryRunPage() {
  const { accountKey, accountData, userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(String(EVOX_CURRENT_YEAR));
  const [zip, setZip] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [priority, setPriority] = useState<string[]>(['lease', 'apr', 'cash']);
  const [minDays, setMinDays] = useState('7');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Overview is the default: the day-to-day question is "is it healthy", and
  // the dry run is the diagnostic you reach for when the chain looks wrong.
  const [tab, setTab] = useState<AutomationView | 'dryrun'>('settings');

  // `?tab=settings` lets the things that point here ("needs a template mapped")
  // land on the tab that fixes it. Read after mount rather than in the initial
  // state, so the server-rendered markup and the first client render agree.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    const match = TABS.find(([id]) => id === wanted);
    if (match) setTab(match[0]);
  }, []);

  // Owned here, not in the panel: the on/off switch lives in this header while
  // the settings form lives in a tab, and both need the same saved snapshot.
  const automation = useAutomation(accountKey);

  // Seed make + ZIP from the active sub-account (the same defaults the worker
  // would use), without clobbering anything already typed.
  useEffect(() => {
    if (accountData?.oem) setMake((m) => m || accountData.oem || '');
    if (accountData?.postalCode) setZip((z) => z || accountData.postalCode || '');
  }, [accountData]);

  useEffect(() => {
    if (!accountKey) return;
    fetch(`/api/ad-generator/templates-doc?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateOption[] }) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, [accountKey]);

  const togglePriority = (t: string) =>
    setPriority((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const run = useCallback(async () => {
    if (!accountKey) {
      toast.error('Pick a sub-account first');
      return;
    }
    if (!model.trim()) {
      toast.error('Enter a model');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/ad-generator/automation/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          make: make.trim(),
          model: model.trim(),
          year: Number(year),
          zip: zip.trim(),
          templateId: templateId || undefined,
          priority,
          minDaysRemaining: Number(minDays) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json as DryRunResult);
      // Failures are the interesting case — open the step that stopped the run.
      const failed = (json.steps as Step[]).find((s) => s.status === 'failed');
      if (failed) setOpen({ [failed.id]: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dry run failed');
    } finally {
      setBusy(false);
    }
  }, [accountKey, make, model, year, zip, templateId, priority, minDays]);

  const yearOptions: SelectOption[] = useMemo(
    () => EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) })),
    [],
  );
  const makeOptions: SelectOption[] = useMemo(
    () => [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))],
    [],
  );
  const templateOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'Auto — newest published in scope' },
      ...templates.map((t) => ({ value: t.id, label: t.name })),
    ],
    [templates],
  );

  // Non-admins get the one decision that is genuinely theirs — the design their
  // automated ads use — instead of a locked door. The inspector (watch scope,
  // offer policy, run caps, dry runs) stays admin-only.
  // `userRole` is null until the session resolves, which made `isAdmin` false for
  // a beat and flashed the dealer's single-card view at admins before the
  // inspector replaced it. Unknown role is "not yet", not "not allowed".
  if (userRole === null) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--muted)]/60" />
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-[var(--muted)]/40" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Link
          href="/ad-generator"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Ads
        </Link>
        <h1 className="mb-1 text-lg font-semibold text-[var(--foreground)]">Automatic ads</h1>
        <p className="mb-6 max-w-2xl text-xs text-[var(--muted-foreground)]">
          Manufacturer offers for {accountData?.dealer || 'this sub-account'} are turned into ads for
          you each month.
        </p>
        <ClientTemplateCard accountKey={accountKey} accountData={accountData} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        href="/ad-generator"
        className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" /> Ad Generator
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Ad automation</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-[var(--muted-foreground)]">
          {/* The old copy said "no ads are created" while a Generate drafts
              button sat directly below it. What's true is that nothing
              PUBLISHES — generated ads land as drafts for a person to approve. */}
          {tab === 'dryrun'
            ? 'Walks the full autonomous chain for one vehicle and reports every step. Nothing is saved — no ad is created, no render is uploaded, no offer state is recorded.'
            : 'Watches this sub-account’s inventory and OEM offers, and builds draft ads from them. Nothing publishes on its own — every generated ad waits for a person.'}
        </p>
        </div>
        <AutomationSwitch automation={automation} />
      </header>

      {/* ── view tabs ── */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 border-b border-[var(--border)]">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors ${
              tab === id
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'dryrun' && <ShadowPanel accountKey={accountKey} view={tab} automation={automation} />}

      {/* The dry run keeps its DOM while other tabs are shown (`hidden`, not
          unmounted) so a trace survives a detour to the other tabs. Its fields are
          throwaway diagnostic parameters — nothing here is ever saved — so they're
          exempt from the unsaved-changes guard, or typing a model here would leave
          every later sub-account switch claiming there were edits to lose. */}
      <div
        data-unsaved-ignore="true"
        className={tab === 'dryrun' ? 'grid gap-6 lg:grid-cols-[340px_1fr]' : 'hidden'}
      >
        {/* ── Inputs ── */}
        <section className="glass-card h-fit rounded-2xl border border-[var(--border)] p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Vehicle
          </h2>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Make</label>
              <Select value={make} onChange={setMake} options={makeOptions} previewFont={false} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Model</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
                placeholder="e.g. Crosstrek"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Year</label>
                <Select value={year} onChange={setYear} options={yearOptions} previewFont={false} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">ZIP</label>
                <input
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
          </div>

          <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Policy
          </h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Offer priority — click to toggle, order is preference
              </label>
              <div className="flex flex-wrap gap-1.5">
                {OFFER_TYPES.map((t) => {
                  const idx = priority.indexOf(t.value);
                  const on = idx >= 0;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => togglePriority(t.value)}
                      aria-pressed={on}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        on
                          ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                          : 'bg-[var(--muted)] text-[var(--muted-foreground)] opacity-60 hover:opacity-100'
                      }`}
                    >
                      {on && <span className="mr-1 opacity-70">{idx + 1}</span>}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Minimum days remaining
              </label>
              <input
                value={minDays}
                onChange={(e) => setMinDays(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Template</label>
              <Select value={templateId} onChange={setTemplateId} options={templateOptions} previewFont={false} />
            </div>
          </div>

          <button
            onClick={run}
            disabled={busy || !accountKey}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
            {busy ? 'Running…' : 'Run dry run'}
          </button>
          {!accountKey && (
            <p className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">
              Pick a sub-account to run against.
            </p>
          )}
        </section>

        {/* ── Trace ── */}
        <section className="min-w-0">
          {!result && !busy && (
            <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                Run the chain to see each step: offers → selection → template → fields → image →
                disclaimer → preflight → render.
              </p>
            </div>
          )}
          {busy && (
            <div className="glass-card rounded-2xl border border-[var(--border)] p-12 text-center">
              <ArrowPathIcon className="mx-auto mb-3 h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
              <p className="text-sm text-[var(--muted-foreground)]">
                Fetching offers, resolving the vehicle image, and rendering…
              </p>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div
                className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                  result.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {result.ok
                  ? 'Chain completed — this offer would have produced a draft ad.'
                  : 'Chain stopped. The failing step below explains why no ad would be produced.'}
              </div>

              <ol className="space-y-2">
                {result.steps.map((s) => {
                  const style = STATUS_STYLE[s.status];
                  const Icon = style.icon;
                  const isOpen = !!open[s.id];
                  return (
                    <li key={s.id} className={`overflow-hidden rounded-xl border ${style.ring}`}>
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]/30"
                      >
                        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${style.className}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="text-sm font-medium text-[var(--foreground)]">{s.label}</span>
                            {s.ms > 0 && (
                              <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                                {s.ms}ms
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block break-words text-xs text-[var(--muted-foreground)]">
                            {s.summary}
                          </span>
                        </span>
                        {s.detail != null && (
                          <ChevronRightIcon
                            className={`mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] transition-transform ${
                              isOpen ? 'rotate-90' : ''
                            }`}
                          />
                        )}
                      </button>
                      {isOpen && s.detail != null && <CopyableDetail value={s.detail} />}
                    </li>
                  );
                })}
              </ol>

              {result.previews.length > 0 && (
                <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
                  <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Rendered output
                  </h2>
                  <div className="flex flex-wrap gap-5">
                    {result.previews.map((p) => (
                      <figure key={p.sizeId} className="min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.dataUrl}
                          alt={`${p.label} render`}
                          className="max-h-72 w-auto rounded-lg border border-[var(--border)] bg-white"
                        />
                        <figcaption className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                          {p.label} · {p.width}×{p.height}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
