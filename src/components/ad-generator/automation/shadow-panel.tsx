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

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { AutomationTemplatePicker, type PickerTemplate } from './template-picker';
import type { AdData } from '@/lib/ad-generator/types';
import Link from 'next/link';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Select } from '@/components/select';
import { HelpTip } from '@/components/ui/help-tip';
import { aspectLabel } from '@/lib/ad-generator/ad-size-library';
import { windowPreview } from '@/lib/ad-generator/automation/window-preview';
import { skipReasonFix, skipReasonLabel, summarizeSkips } from '@/lib/ad-generator/automation/skip-reasons';
import type { CreativeStep, CycleState, RunSummary, ShadowReport } from './types';
import { STEP_LABEL } from '@/lib/playbooks/creative';
import { type Automation } from './use-automation';

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

/**
 * Template size labels are authored as "Square 1080×1080", so printing the
 * dimensions again under them reads as a stutter. Keep the name, let the line
 * below carry ratio + pixels.
 */
function sizeName(label: string, width: number, height: number): string {
  if (!width || !height) return label;
  const stripped = label.replace(new RegExp(`\\s*${width}\\s*[×x]\\s*${height}\\s*$`), '').trim();
  return stripped || label;
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

// ── shared chrome ────────────────────────────────────────────────────────────

/** Every block on the page uses this, so the headings stop competing. */
function Card({
  title,
  help,
  count,
  actions,
  children,
}: {
  title: string;
  help?: React.ReactNode;
  count?: number;
  /** Refresh controls, placed with the data they refresh. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]">
            {count}
          </span>
        )}
        {help && <HelpTip title={title} iconClassName="h-3.5 w-3.5">{help}</HelpTip>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
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


const OFFER_TYPE_LABEL: Record<string, string> = { lease: 'Lease', apr: 'APR', cash: 'Cash' };
const ALL_OFFER_TYPES = ['lease', 'apr', 'cash'];

/**
 * The offer-type priority, as an ordered row of chips.
 *
 * Reordering rather than a dropdown because the ORDER is the setting — this is
 * the rule that answers "why did it run the lease and not the APR", which had
 * no answer on screen at all before.
 */
function OfferPriorityPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const enabled = value.filter((t) => ALL_OFFER_TYPES.includes(t));
  const disabled = ALL_OFFER_TYPES.filter((t) => !enabled.includes(t));

  const move = (i: number) => {
    const next = [...enabled];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {enabled.map((t, i) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--background)] py-0.5 pl-2 pr-1 text-[11px] text-[var(--foreground)]"
        >
          <span className="tabular-nums text-[var(--muted-foreground)]">{i + 1}</span>
          {OFFER_TYPE_LABEL[t] ?? t}
          {i > 0 && (
            <button
              type="button"
              onClick={() => move(i)}
              aria-label={`Move ${OFFER_TYPE_LABEL[t] ?? t} up`}
              className="px-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              ↑
            </button>
          )}
          {/* Removing the last type would make nothing eligible and generate
              zero ads, which reads as a broken automation rather than a choice. */}
          {enabled.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(enabled.filter((x) => x !== t))}
              aria-label={`Remove ${OFFER_TYPE_LABEL[t] ?? t}`}
              className="px-0.5 text-[var(--muted-foreground)] transition-colors hover:text-red-500"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {disabled.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange([...enabled, t])}
          className="rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          + {OFFER_TYPE_LABEL[t] ?? t}
        </button>
      ))}
    </div>
  );
}

/**
 * The coverage chain: VINs on the lot → trims → offers → ads.
 *
 * This is the "is it working" answer, and it replaces four empty text boxes
 * that made a VIN-driven default look like unfinished setup. Every link is a
 * count you can act on: a drop between any two is a specific, findable problem
 * (no feed, no OEM programme, a stock gate) rather than a vague "nothing
 * generated".
 */
function CoverageFunnel({
  totals,
  narrowed,
}: {
  totals: ShadowReport['totals'] | undefined;
  narrowed: boolean;
}) {
  if (!totals) {
    return (
      <div className="h-[62px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)]" />
    );
  }

  const steps = [
    { n: totals.vins, label: 'VINs on the lot' },
    { n: totals.trimGroups, label: 'trims' },
    { n: totals.groupsWithOffer, label: 'with a live offer' },
    { n: totals.adsThisRun, label: 'ads this run' },
  ];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            {i > 0 && <ChevronRightIcon className="h-3 w-3 text-[var(--muted-foreground)]" />}
            <div>
              <span
                className={`text-lg font-semibold tabular-nums ${
                  // Only the last link is judged: zero ads is the failure the
                  // whole chain exists to explain. Zero VINs on a lot with no
                  // feed yet is a setup state, not an alarm.
                  i === steps.length - 1 && s.n === 0
                    ? 'text-amber-500'
                    : 'text-[var(--foreground)]'
                }`}
              >
                {s.n}
              </span>{' '}
              <span className="text-[11px] text-[var(--muted-foreground)]">{s.label}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
        {narrowed
          ? 'Every VIN on the lot, narrowed by the filters below, gets its best regional offer.'
          : 'Every VIN on the lot gets its best regional offer — no setup needed.'}
      </p>
    </div>
  );
}

/**
 * A rendered preview of the companion offer email.
 *
 * Renders the real HTML in a sandboxed iframe rather than reimplementing the
 * layout in React: the email builder is the only thing that knows what actually
 * gets sent, and a second renderer would drift from it silently — which is the
 * exact failure a preview exists to prevent.
 *
 * Debounced, because it re-renders on every keystroke in Max offers.
 */
function OfferEmailPicker({
  accountKey,
  templateId,
  maxOffers,
  onChange,
}: {
  accountKey: string | null;
  templateId: string;
  maxOffers: string;
  onChange: (slug: string) => void;
}) {
  const [state, setState] = useState<{
    subject: string;
    offers: number;
    sample: boolean;
    notes: string[];
    options: { slug: string; title: string; html: string; usable: boolean }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          accountKey,
          maxOffers: String(Number(maxOffers) || 6),
        });
        const res = await fetch(`/api/ad-generator/automation/offer-email-preview?${qs}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error);
        setState(json);
        setFailed(false);
      } catch {
        // A preview that can't render must not take the settings form with it.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // NOT keyed on templateId: every shell is rendered in one pass, so changing
    // the selection is a local highlight, not a refetch.
  }, [accountKey, maxOffers]);

  if (failed) {
    return (
      <p className="mt-3 text-[10px] text-[var(--muted-foreground)]">
        Couldn&apos;t render the preview.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--foreground)]">Template</span>
        {state && (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {state.subject} · {state.offers} offer{state.offers === 1 ? '' : 's'}
          </span>
        )}
        {loading && <span className="text-[10px] text-[var(--muted-foreground)]">Rendering…</span>}
        {state?.sample && (
          // Never let invented figures pass as real ones — someone will
          // screenshot this.
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
            Placeholder offers
          </span>
        )}
      </div>

      {state?.notes.map((n) => (
        <p key={n} className="mb-1.5 flex gap-1 text-[10px] text-amber-500">
          <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{n}</span>
        </p>
      ))}

      {loading && !state && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[196px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)]"
            />
          ))}
        </div>
      )}

      {state && (
        <div role="radiogroup" aria-label="Offer email template" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.options.map((opt) => {
            const selected = opt.slug === templateId;
            return (
              <button
                key={opt.slug || 'brand-kit'}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(opt.slug)}
                className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  selected
                    ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]'
                    : 'border-[var(--border)] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-lg'
                }`}
              >
                {selected && (
                  <CheckCircleIcon className="absolute right-2 top-2 z-10 h-5 w-5 text-[var(--primary)] drop-shadow" />
                )}
                {/* A wide render scaled down, so the thumbnail has an email's
                    proportions instead of a 260px-wide squeeze of one. The
                    overlay swallows clicks — the CARD is the control, and a
                    stray link inside the iframe must not compete with it. */}
                <div className="relative h-[150px] overflow-hidden bg-white">
                  <iframe
                    title={`${opt.title} preview`}
                    sandbox=""
                    srcDoc={opt.html}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="h-[500px] w-[600px] origin-top-left border-0"
                    style={{ transform: 'scale(0.42)' }}
                  />
                  <div className="absolute inset-0" />
                </div>
                <div className="border-t border-[var(--border)] bg-[var(--card)] p-2.5">
                  <div className="truncate text-xs font-semibold text-[var(--foreground)]">
                    {opt.title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                    {opt.slug === '' ? (
                      'Built from this sub-account’s branding'
                    ) : opt.usable ? (
                      'Offers replace its {{offers}} block'
                    ) : (
                      <span className="text-amber-500">
                        No {'{{offers}}'} block — nothing would be sent
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── settings form ────────────────────────────────────────────────────────────

/**
 * Which slice of the panel to show. The page owns the tab bar; the status strip
 * and its run-now actions render on all of them, because "is it on" and "run it
 * now" are questions you have regardless of which table you're reading.
 */
// 'settings' is the Config tab. The key is left alone deliberately: it's the
// persisted `save_config` action name and the report's `scope` key, so renaming
// the label is a UI change and renaming the key would be a data migration.
export type AutomationView = 'inventory' | 'drafts' | 'runs' | 'settings';

/**
 * One run in the history, expandable when it passed vehicles over.
 *
 * The count alone ("1 skipped") was a dead end: the generate toast sends you here
 * to find out why, and the reason was sitting unread in the run's own record. Each
 * skip now names the vehicle, what stopped it, the generator's own detail, and
 * where to go to fix it.
 */
function RunRow({ run: r }: { run: RunSummary }) {
  const [open, setOpen] = useState(false);
  const skips = r.skipped ?? [];
  const expandable = skips.length > 0;

  return (
    <div
      className={`rounded-lg border text-[11px] ${
        r.error ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)]"
            >
              <ChevronRightIcon className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
              <span className="rounded bg-[var(--muted)] px-1.5 py-0.5">{r.kind.replace('_', ' ')}</span>
            </button>
          ) : (
            <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-medium text-[var(--muted-foreground)]">
              {r.kind.replace('_', ' ')}
            </span>
          )}
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
              {r.generatedCount != null && r.generatedCount > 0 && (
                <span className="text-emerald-500">{r.generatedCount} built</span>
              )}
              {r.issueCount > 0 && (
                <span className="text-amber-500">
                  {r.issueCount} skipped
                  {expandable && !open && <span className="ml-1 opacity-70">— why?</span>}
                </span>
              )}
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
        {/* The reasons matter most when a run built nothing, so don't make that
            case a click: say it on the row and let the panel carry the detail. */}
        {expandable && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full text-left text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            {summarizeSkips(skips)}
          </button>
        )}
      </div>

      {open && expandable && (
        <div className="space-y-1.5 border-t border-[var(--border)] px-3 py-2">
          {skips.map((s, i) => {
            const fix = skipReasonFix(s.reason);
            return (
              <div key={`${s.vehicle}-${i}`} className="rounded-md bg-[var(--muted)]/25 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-[var(--foreground)]">{s.vehicle}</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                    {skipReasonLabel(s.reason)}
                  </span>
                </div>
                {s.detail && <p className="mt-1 break-words text-[var(--muted-foreground)]">{s.detail}</p>}
                {fix && <p className="mt-1 text-[10px] text-[var(--muted-foreground)]/80">{fix}</p>}
              </div>
            );
          })}
          {r.issueCount > skips.length && (
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Showing {skips.length} of {r.issueCount}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ShadowPanel({
  accountKey,
  view,
  automation,
}: {
  accountKey: string | null;
  view: AutomationView;
  automation: Automation;
}) {
  const { report, loading, busy, form, dirty, set, reset, act, save } = automation;
  // Previews render in the sub-account's own logo and colour, so what an admin
  // approves here is what that dealer's ads will actually look like.
  const { accountData } = useAccount();
  const branding = brandingFromAccount(accountData) as AdData;
  // Narrowing is collapsed unless it's actually in use — an open, empty filter
  // panel is what made the default look unfinished in the first place.
  const narrowed =
    !!form.makes.trim() || !!form.focus.trim() || !!form.exclude.trim() || Number(form.minStock) > 0;
  const [narrowOpen, setNarrowOpen] = useState(narrowed);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');

  const templates = report?.templates ?? [];
  const templateSizes = templates.find((t) => t.id === form.templateId)?.sizes ?? [];

  // Companion offer email. The shell list is NOT read here — the picker fetches
  // its own, because each card needs the RENDERED email, not just a title.
  const audiences = report?.audiences ?? [];

  // ── playbook ──
  const playbookOptions = report?.playbookOptions ?? [];
  // The report's own `playbook` is resolved against the SAVED config, so it only
  // matches the picker while nothing is edited. Re-resolve against the option
  // the form currently holds, or switching playbooks would keep describing the
  // old one until a save round-trips.
  const playbook = useMemo(() => {
    if (!form.playbookId) return null;
    // Options carry their definitions, so a freshly picked playbook resolves
    // fully without waiting for a save to round-trip.
    const opt = playbookOptions.find((p) => p.id === form.playbookId);
    if (opt) return { id: opt.id, name: opt.name, version: opt.version, definition: opt.definition };
    // Followed but no longer published — keep describing it rather than
    // silently showing "None" over a config it is still driving.
    if (report?.playbook?.id === form.playbookId) return report.playbook;
    return null;
  }, [form.playbookId, report?.playbook, playbookOptions]);

  // Drift computed from what's ON SCREEN, not from the saved report: an override
  // should light up the moment you make it, not after you save.
  const detached: CreativeStep[] = useMemo(() => {
    const def = playbook?.definition;
    if (!def) return [];
    const out: CreativeStep[] = [];
    if (form.templateId !== def.adTemplateId) out.push('adTemplate');
    const a = [...form.sizeIds].sort().join(' ');
    const b = [...def.sizeIds].sort().join(' ');
    if (a !== b) out.push('sizes');
    if (form.emailTemplateId !== def.emailTemplateSlug) out.push('emailTemplate');
    if ((Number(form.emailMaxOffers) || 6) !== def.emailMaxOffers) out.push('emailMaxOffers');
    return out;
  }, [playbook, form.templateId, form.sizeIds, form.emailTemplateId, form.emailMaxOffers]);

  /** Picking a playbook writes every field it presets, in one move. */
  const applyPlaybook = (id: string) => {
    set('playbookId', id);
    if (!id) return; // Unlinking leaves the creative alone — nothing is lost.
    const def = playbookOptions.find((p) => p.id === id)?.definition;
    if (!def) return;
    set('templateId', def.adTemplateId);
    set('sizeIds', [...def.sizeIds]);
    set('emailTemplateId', def.emailTemplateSlug);
    set('emailMaxOffers', String(def.emailMaxOffers));
  };

  /** Undo ONE override, leaving the others alone. */
  const resetPlaybookStep = (step: CreativeStep) => {
    const def = playbook?.definition;
    if (!def) return;
    switch (step) {
      case 'adTemplate':
        set('templateId', def.adTemplateId);
        // Sizes belong to the design, so ids picked against another template
        // would silently render nothing.
        set('sizeIds', [...def.sizeIds]);
        break;
      case 'sizes':
        set('sizeIds', [...def.sizeIds]);
        break;
      case 'emailTemplate':
        set('emailTemplateId', def.emailTemplateSlug);
        break;
      case 'emailMaxOffers':
        set('emailMaxOffers', String(def.emailMaxOffers));
        break;
    }
  };

  // Designs WITH their docs, so the picker can render a real preview of each.
  // The shadow report carries only names and sizes; this is the endpoint built
  // for the dealer-facing picker, and reusing it keeps both surfaces showing the
  // same list resolved the same way.
  const [pickerTemplates, setPickerTemplates] = useState<PickerTemplate[]>([]);
  useEffect(() => {
    if (!accountKey) {
      setPickerTemplates([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/ad-generator/automation/template?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: PickerTemplate[] }) => {
        if (!cancelled) setPickerTemplates(d.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setPickerTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);
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
      {/* Environment problems affecting every generated ad.
          Kept when the at-a-glance stats were removed, and kept OUTSIDE the
          tabs: "every ad you generate is broken" must not be reachable only by
          picking the right tab. */}
      {sharedNotes.size > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
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

      {/* ── config ── */}
      {view === 'settings' && (
      <section className="glass-card rounded-2xl border border-[var(--border)]">
        <div className="flex items-center gap-3 p-5 pb-0">
          <Cog6ToothIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              Config
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
            {/* ── source ──
                The four filter boxes used to lead, which made a VIN-driven
                default look like setup you hadn't finished. They're narrowing,
                not configuration: blank means EVERY VIN on the lot. So the
                default states itself, the funnel proves it, and the filters
                collapse out of the way. */}
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Which vehicles
              </h3>
              <CoverageFunnel totals={report?.totals} narrowed={narrowed} />

              <button
                type="button"
                onClick={() => setNarrowOpen((v) => !v)}
                className="mt-2.5 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                <ChevronRightIcon
                  className={`h-3 w-3 transition-transform ${narrowOpen ? 'rotate-90' : ''}`}
                />
                {narrowed ? 'Narrowing applied' : 'Narrow this'}
              </button>

              {narrowOpen && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              )}
            </div>

            {/* Which offers count as advertisable */}
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Which offers count
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Plan for"
                  help={
                    <>
                      <p>The date range an offer has to stay valid through to be usable. It&apos;s what the <strong>Cycle</strong> column and the match rate above are measured against.</p>
                      <p>Most manufacturers publish month by month, so <strong>next month</strong> is the usual choice — it&apos;s what lets you build next month&apos;s ads before it starts.</p>
                    </>
                  }
                >
                  <Select
                    value={form.windowMode}
                    onChange={(v) => set('windowMode', v)}
                    previewFont={false}
                    options={[
                      { value: 'next_month', label: 'Next month' },
                      { value: 'current_month', label: 'This month' },
                      { value: 'rolling', label: 'Rolling 30 days' },
                    ]}
                  />
                  <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                    Offers must be valid through{' '}
                    <span className="text-[var(--foreground)]">{windowPreview(form.windowMode)}</span>.
                  </p>
                </Field>
                <Field
                  label="ZIP"
                  help={
                    <>
                      <p>Which market to look offers up in. Manufacturer incentives are regional — the same model carries different money in different areas.</p>
                      <p>Use the dealership&apos;s own ZIP. Left blank, the sub-account&apos;s postal code is used.</p>
                    </>
                  }
                >
                  <input value={form.zip} onChange={(e) => set('zip', e.target.value)} placeholder="84401" className={inputClass} />
                </Field>
              </div>

              {/* ── which offer wins ──
                  The priority order was always stored per sub-account and never
                  shown, so "why did it run the lease and not the APR" had no
                  answer on screen. It's the rule, so it belongs here. */}
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-[var(--foreground)]">
                      Best offer
                    </span>
                    <HelpTip title="Best offer" iconClassName="h-3 w-3">
                      <p>
                        When a vehicle qualifies for several programmes, the earliest type in
                        this order wins — and within a type, the strongest offer (cheapest
                        payment, lowest rate, biggest cash).
                      </p>
                      <p className="mt-1.5">
                        Drop a type to make it never eligible.
                      </p>
                    </HelpTip>
                  </div>
                  <OfferPriorityPicker
                    value={form.offerPriority}
                    onChange={(next) => set('offerPriority', next)}
                  />
                </div>

                <label className="mt-2.5 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={form.expandOfferTypes}
                    onChange={(e) => set('expandOfferTypes', e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    Build an ad for <strong>every</strong> qualifying type, not just the best —
                    a lease ad and an APR ad for the same vehicle.
                  </span>
                </label>
                {/* Expansion multiplies the run against a cap that would then
                    truncate to an arbitrary subset, so the arithmetic is shown
                    rather than discovered in Run history. */}
                {form.expandOfferTypes && (
                  <p className="mt-1.5 flex gap-1 text-[10px] text-amber-500">
                    <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span>
                      This multiplies the run. The cap of {form.maxAds || 10} ads still applies,
                      and anything over it is cut without choosing which.
                    </span>
                  </p>
                )}
              </div>
            </div>
        </div>
      </section>
      )}

      {/* ── creative ──
          Its own container, not a third heading inside Config above. The two
          answer different questions — WHICH offers get advertised versus WHAT
          the advertising looks like — and only the second is worth browsing
          visually, so it wants the room. */}
      {view === 'settings' && (
      <section className="glass-card rounded-2xl border border-[var(--border)]">
        <div className="flex items-center gap-3 p-5 pb-0">
          <PhotoIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--foreground)]">Creative</div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
              What the ads and the offer email look like.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5 px-5 pb-5">
            {/* How ads are built */}
            <div>

              {/* ── playbook ──
                  Above the individual pickers because it SETS them: picking one
                  fills in the ad template, sizes and email shell in a single
                  move, which is the whole point of not choosing each separately.
                  Everything below stays editable — an override detaches just
                  that step (docs/playbooks.md §7 decision 3: flag, never block). */}
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-[var(--foreground)]">Playbook</span>
                    <HelpTip title="Playbook" iconClassName="h-3 w-3">
                      <p>
                        A named pairing of the ad design and the offer-email template, authored once
                        for the agency and applied to many sub-accounts.
                      </p>
                      <p className="mt-1.5">
                        Picking one fills in everything below. You can still change any of it —
                        that step just shows as <strong>overridden</strong> instead of quietly
                        diverging.
                      </p>
                    </HelpTip>
                  </div>
                  {playbook && detached.length === 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                      Following v{playbook.version}
                    </span>
                  )}
                  {playbook && detached.length > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                      {detached.length} override{detached.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <div className="ml-auto w-full sm:w-64">
                    <Select
                      value={form.playbookId}
                      onChange={applyPlaybook}
                      previewFont={false}
                      options={[
                        { value: '', label: 'None — pick each by hand' },
                        ...playbookOptions.map((p) => ({
                          value: p.id,
                          label: p.scopeValue ? `${p.name} · ${p.scopeValue}` : p.name,
                        })),
                      ]}
                    />
                  </div>
                </div>

                {playbook && detached.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      Overridden here:
                    </span>
                    {detached.map((step) => (
                      // Per-step undo. A single "reset to playbook" would throw
                      // away deliberate overrides the person wasn't looking at.
                      <button
                        key={step}
                        onClick={() => resetPlaybookStep(step)}
                        className="group flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium text-amber-500 transition-colors hover:bg-amber-500/15"
                      >
                        {STEP_LABEL[step]}
                        <span className="text-[var(--muted-foreground)] group-hover:text-amber-500">
                          undo
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {!playbook && playbookOptions.length === 0 && (
                  <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
                    No published playbooks yet — build one in Playbooks → Library, or keep picking
                    each piece by hand below.
                  </p>
                )}
              </div>

              {/* The design is the one setting whose value is a PICTURE. A list of
                  names made a wrong pick invisible until the ads came out, so it
                  gets previews and the width to show them — and it's the dealer's
                  own choice too, rendered by the same component they see. */}
              <div className="mb-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--foreground)]">Template</span>
                  {!form.templateId && (
                    <span className="text-[10px] text-amber-500">
                      Not mapped — generation will skip every vehicle
                    </span>
                  )}
                </div>
                <AutomationTemplatePicker
                  templates={pickerTemplates}
                  value={form.templateId}
                  onChange={(v) => set('templateId', v)}
                  branding={branding}
                  showUnusable
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Max ads per run" help={<p>Ceiling on how many ads one <strong>Generate drafts</strong> produces, so a big feed change can&apos;t flood the review queue with a hundred ads at once.</p>}>
                  <input value={form.maxAds} onChange={(e) => set('maxAds', e.target.value.replace(/[^0-9]/g, ''))} className={inputClass} />
                </Field>

                <Field label="Output" help={<p><strong>Draft</strong> holds every ad for a person to approve. <strong>Ready</strong> publishes automatically, but only for makes with a verified co-op pack.</p>}>
                  <Select
                    value={form.mode}
                    onChange={(v) => set('mode', v)}
                    previewFont={false}
                    options={[
                      { value: 'draft', label: 'Draft — a person approves' },
                      { value: 'ready', label: 'Ready — needs verified co-op' },
                    ]}
                  />
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
                    className="sm:col-span-2 lg:col-span-3"
                    help={<p>Which of the template&apos;s sizes to render. Select none to render <strong>all {templateSizes.length}</strong>.</p>}
                  >
                    <div className="flex flex-wrap gap-2">
                      {templateSizes.map((sz) => {
                        const on = form.sizeIds.length === 0 || form.sizeIds.includes(sz.id);
                        const ratio = sz.width && sz.height ? aspectLabel(sz.width, sz.height) : null;
                        // A proportional swatch, so "9:16 vs 1.91:1" is something
                        // you can see rather than something you have to picture.
                        const box = sz.width && sz.height
                          ? sz.width >= sz.height
                            ? { width: 22, height: Math.max(7, Math.round((22 * sz.height) / sz.width)) }
                            : { height: 22, width: Math.max(7, Math.round((22 * sz.width) / sz.height)) }
                          : null;
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
                            aria-pressed={on}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                              on
                                ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                                : 'border-[var(--border)] hover:border-[var(--primary)]'
                            }`}
                          >
                            {box && (
                              <span
                                style={box}
                                className={`flex-shrink-0 rounded-[2px] border ${
                                  on ? 'border-[var(--primary)] bg-[var(--primary)]/30' : 'border-[var(--muted-foreground)]/50'
                                }`}
                              />
                            )}
                            <span className="leading-tight">
                              <span
                                className={`block text-[11px] font-medium ${
                                  on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                                }`}
                              >
                                {sizeName(sz.label, sz.width, sz.height)}
                              </span>
                              {ratio && (
                                <span className="block text-[10px] tabular-nums text-[var(--muted-foreground)]">
                                  {ratio} · {sz.width}×{sz.height}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}
              </div>

              {/* ── companion offer email ──
                  Its own block rather than another cell in the grid: everything
                  above configures the ADS, and a customer-facing send sitting
                  inline among render settings is too easy to switch on without
                  noticing. */}
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1">
                    <h4 className="text-xs font-semibold text-[var(--foreground)]">Offer email</h4>
                    <HelpTip title="Offer email" iconClassName="h-3 w-3">
                      <p>
                        Drafts <strong>one email per run</strong> covering the same offers that
                        produced ads — never one per offer. The manufacturer&apos;s own wording and
                        the ad&apos;s disclaimer are reproduced exactly.
                      </p>
                      <p className="mt-1.5">
                        It is <strong>always a draft</strong>. Unlike ads there is no automatic
                        send: a person picks the moment.
                      </p>
                    </HelpTip>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {form.emailEnabled ? 'On' : 'Off'}
                    </span>
                    <input
                      type="checkbox"
                      checked={form.emailEnabled}
                      onChange={(e) => set('emailEnabled', e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--primary)]"
                    />
                  </label>
                </div>

                {form.emailEnabled && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field
                      label="Audience"
                      help={
                        <p>
                          Who the draft is addressed to. Leave unset and the draft lands with{' '}
                          <strong>no recipients</strong>, so it can never send.
                        </p>
                      }
                    >
                      <Select
                        value={form.emailAudienceId}
                        onChange={(v) => set('emailAudienceId', v)}
                        previewFont={false}
                        options={[
                          { value: '', label: 'None — leave untargeted' },
                          ...audiences.map((a) => ({ value: a.id, label: a.name })),
                        ]}
                      />
                      {/* Silence here would read as "configured" while every
                          draft quietly lands with nobody to send it to. */}
                      {!form.emailAudienceId && (
                        <p className="mt-1.5 flex gap-1 text-[10px] text-amber-500">
                          <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                          <span>Drafts will need an audience picked by hand before they can send.</span>
                        </p>
                      )}
                    </Field>

                    <Field
                      label="Max offers"
                      help={
                        <p>
                          How many offers the email features, best first. The rest still become ads
                          — they just don&apos;t all get a slot in one send.
                        </p>
                      }
                    >
                      <input
                        value={form.emailMaxOffers}
                        onChange={(e) => set('emailMaxOffers', e.target.value.replace(/[^0-9]/g, ''))}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                )}

                {/* The email is the one setting whose value is a PICTURE, same
                    as the ad template above it. A dropdown of shell names makes
                    a wrong pick invisible until the send goes out. */}
                {form.emailEnabled && (
                  <OfferEmailPicker
                    accountKey={accountKey}
                    templateId={form.emailTemplateId}
                    maxOffers={form.emailMaxOffers}
                    onChange={(slug) => set('emailTemplateId', slug)}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
              {dirty && (
                <button
                  onClick={reset}
                  disabled={!!busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Discard changes
                </button>
              )}
              <button
                onClick={save}
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
        actions={
          <button
            onClick={() => act('sync_feeds')}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${busy === 'sync_feeds' ? 'animate-spin' : ''}`} />
            Sync inventory
          </button>
        }
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
        actions={
          <button
            onClick={() => act('poll_offers')}
            disabled={!!busy}
            title="Re-check the manufacturer for offers on every watched vehicle."
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            {busy === 'poll_offers' ? (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" />
            )}
            Refresh offers
          </button>
        }
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
            <p>The list builds itself. Anything with new stock in the feed and inside your Config scope lands here — there&apos;s nothing to add by hand.</p>
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
            {/* Generation is gated on a mapped template, so this used to point at
                a menu item that wasn't rendered yet — name the missing piece
                instead of sending people to look for a control that isn't there. */}
            {report && !report.scope.templateMap.all ? (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                No template is mapped yet, so a run would skip every vehicle. Pick one under{' '}
                <strong>Creative → How ads are built</strong>.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Build ads from the offers on file with{' '}
                <strong>New ad → Generate from OEM offers</strong> on the Ad Generator.
              </p>
            )}
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
      {/* Followed Overview's stats onto Inventory: lead time is a property of
          the OEM programmes behind the stock shown there. */}
      {view === 'inventory' && report?.leadTimes.length ? (
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
            {report.runs.map((r) => <RunRow key={r.id} run={r} />)}
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
