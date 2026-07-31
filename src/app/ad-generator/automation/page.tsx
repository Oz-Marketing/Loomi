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
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from '@/components/ad-generator/client-form/evox-makes';
import { ShadowPanel } from '@/components/ad-generator/automation/shadow-panel';

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
  // Shadow is the default view: Phase 1's job is watching, and the dry run is
  // the diagnostic you reach for when something in the chain looks wrong.
  const [tab, setTab] = useState<'shadow' | 'dryrun'>('shadow');

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

  const yearOptions: FontSelectOption[] = useMemo(
    () => EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) })),
    [],
  );
  const makeOptions: FontSelectOption[] = useMemo(
    () => [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))],
    [],
  );
  const templateOptions: FontSelectOption[] = useMemo(
    () => [
      { value: '', label: 'Auto — newest published in scope' },
      ...templates.map((t) => ({ value: t.id, label: t.name })),
    ],
    [templates],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">
          The automation inspector is limited to admins.
        </p>
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

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Ad automation</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-[var(--muted-foreground)]">
          {tab === 'shadow'
            ? 'Phase 1 — shadow mode. Records OEM offer history and dealer inventory so the feed’s real behaviour is known before anything generates unattended. No ads are created.'
            : 'Walks the full autonomous chain for one vehicle and reports every step. Nothing is saved — no ad is created, no render is uploaded, no offer state is recorded.'}
        </p>
      </header>

      {/* ── view tabs ── */}
      <div className="mb-6 flex items-center gap-5 border-b border-[var(--border)]">
        {([
          ['shadow', 'Shadow mode'],
          ['dryrun', 'Dry run'],
        ] as const).map(([id, label]) => (
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

      {tab === 'shadow' && <ShadowPanel accountKey={accountKey} />}

      <div className={tab === 'dryrun' ? 'grid gap-6 lg:grid-cols-[340px_1fr]' : 'hidden'}>
        {/* ── Inputs ── */}
        <section className="glass-card h-fit rounded-2xl border border-[var(--border)] p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Vehicle
          </h2>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Make</label>
              <FontSelect value={make} onChange={setMake} options={makeOptions} previewFont={false} />
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
                <FontSelect value={year} onChange={setYear} options={yearOptions} previewFont={false} />
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
              <FontSelect value={templateId} onChange={setTemplateId} options={templateOptions} previewFont={false} />
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
