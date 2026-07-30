'use client';

/**
 * OEM Guidelines & Sales Events (admin) — the co-op team's surface.
 *
 * Two asset types per manufacturer, together because they're the same job:
 * versioned, time-boxed, co-op-owned, and consequential when stale.
 *
 *   Guidelines   the source PDF + its transcribed rule pack + the verified toggle
 *   Sales events the campaign mark + its window + whether the OEM mandates it
 *
 * The page leads with STALENESS rather than listings. Nobody forgets to upload a
 * document; what actually happens is an event window closing with no successor
 * queued, after which ads silently stop carrying a mark the manufacturer requires
 * — or get refused outright when it's mandatory.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';

type EventState = 'covered' | 'ending_soon' | 'upcoming' | 'none';

interface EventRow {
  id: string;
  name: string;
  logoUrl: string;
  effectiveFrom: string;
  effectiveTo: string;
  required: boolean;
  offerTypes: string[];
  isActive: boolean;
  phase: 'past' | 'live' | 'future';
  daysRemaining: number | null;
}

interface PackRow {
  id: string;
  version: string;
  source: string | null;
  sourceUrl: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  isActive: boolean;
  ruleCount: number;
  warningCount: number;
  errorCount: number;
  updatedAt: string;
}

interface MakeAssets {
  make: string;
  packs: PackRow[];
  events: EventRow[];
  eventState: EventState;
  eventSummary: string;
  unverified: boolean;
}

const EVENT_STATE: Record<EventState, { label: string; className: string }> = {
  covered: { label: 'Covered', className: 'bg-emerald-500/15 text-emerald-500' },
  ending_soon: { label: 'Ending soon', className: 'bg-amber-500/15 text-amber-500' },
  upcoming: { label: 'Upcoming', className: 'bg-blue-500/15 text-blue-500' },
  none: { label: 'No event', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]' },
};

const PHASE: Record<EventRow['phase'], string> = {
  live: 'text-emerald-500',
  future: 'text-blue-500',
  past: 'text-[var(--muted-foreground)]',
};

const OFFER_TYPES = ['lease', 'apr', 'discount', 'sales_price'] as const;

/** Blank draft for the "add event" form. */
const emptyDraft = (make: string) => ({
  id: '',
  make,
  name: '',
  logoUrl: '',
  effectiveFrom: '',
  effectiveTo: '',
  required: true,
  offerTypes: [] as string[],
});

export default function OemAssetsPage() {
  const { userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  const [makes, setMakes] = useState<MakeAssets[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof emptyDraft> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ad-generator/oem-assets');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMakes(json.makes ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load OEM assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (action: string, extra: Record<string, unknown>, label: string, okMsg: string) => {
      setBusy(label);
      try {
        const res = await fetch('/api/ad-generator/oem-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        toast.success(okMsg);
        await load();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">
          OEM guidelines and sales events are limited to admins.
        </p>
      </div>
    );
  }

  const needsAttention = makes.filter((m) => m.eventState === 'ending_soon');

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        href="/ad-generator"
        className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" /> Ad Generator
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">OEM guidelines &amp; sales events</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Per manufacturer: the co-op guideline document and its transcribed rules, plus the sales-event
            marks that must appear on ads during a campaign window.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {/* ── the thing that actually goes wrong ── */}
      {needsAttention.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <ExclamationTriangleIcon className="h-4 w-4" />
            {needsAttention.length} manufacturer{needsAttention.length > 1 ? 's have' : ' has'} an event window
            closing with nothing queued behind it
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-amber-600/90 dark:text-amber-400/90">
            {needsAttention.map((m) => (
              <li key={m.make}>
                <span className="font-medium">{m.make}</span> — {m.eventSummary}
              </li>
            ))}
          </ul>
        </div>
      )}

      {makes.length === 0 && !loading && (
        <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            No manufacturers yet. A make appears here once it has a rule pack, an event, or a sub-account
            configured for automation.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {makes.map((m) => {
          const st = EVENT_STATE[m.eventState];
          return (
            <section key={m.make} className="glass-card rounded-2xl border border-[var(--border)] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                  {m.make}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.className}`}>
                    {st.label}
                  </span>
                  {m.unverified && (
                    <span
                      className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
                      title="No verified pack — ads for this make cannot be auto-approved"
                    >
                      unverified
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-[var(--muted-foreground)]">{m.eventSummary}</p>
              </div>

              {/* ── guideline packs ── */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Guidelines
              </h3>
              {m.packs.length === 0 ? (
                <p className="mb-4 text-xs text-[var(--muted-foreground)]">
                  No pack transcribed. Nothing for this make is checked against manufacturer rules.
                </p>
              ) : (
                <div className="mb-4 space-y-2">
                  {m.packs.map((p) => (
                    <div
                      key={p.id}
                      className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                        p.verified ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <DocumentTextIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
                          <span className="text-sm font-medium text-[var(--foreground)]">{p.version}</span>
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            {p.ruleCount} rules · {p.errorCount} blocking · {p.warningCount} advisory
                          </span>
                          {p.sourceUrl && (
                            <a
                              href={p.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-medium text-[var(--primary)] hover:underline"
                            >
                              open document →
                            </a>
                          )}
                        </div>
                        {p.source && (
                          <p className="mt-1 break-words text-[11px] text-[var(--muted-foreground)]">{p.source}</p>
                        )}
                        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                          {p.verified ? (
                            <>
                              Verified{p.verifiedBy ? ` by ${p.verifiedBy}` : ''}
                              {p.verifiedAt ? ` on ${p.verifiedAt.slice(0, 10)}` : ''} — rules can block a
                              non-compliant ad.
                            </>
                          ) : (
                            <>
                              Not verified — every finding is downgraded to a warning, and ads for this make
                              cannot be auto-approved.
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          act(
                            'set_verified',
                            { packId: p.id, verified: !p.verified },
                            `v-${p.id}`,
                            p.verified ? 'Verification removed' : 'Pack marked verified',
                          )
                        }
                        disabled={!!busy}
                        className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          p.verified
                            ? 'border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]/40'
                            : 'bg-[var(--primary)] text-white hover:opacity-90'
                        }`}
                      >
                        {p.verified ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <ShieldCheckIcon className="h-3.5 w-3.5" />}
                        {p.verified ? 'Verified' : 'Mark verified'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── sales events ── */}
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Sales events
                </h3>
                <button
                  onClick={() => setDraft(emptyDraft(m.make))}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                >
                  <PlusIcon className="h-3 w-3" /> Add event
                </button>
              </div>
              {m.events.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">No events on file.</p>
              ) : (
                <div className="space-y-1.5">
                  {m.events.map((e) => (
                    <div
                      key={e.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                        e.phase === 'live' ? 'border-emerald-500/30' : 'border-[var(--border)]'
                      } ${e.isActive ? '' : 'opacity-50'}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={e.logoUrl}
                          alt=""
                          className="h-6 w-12 flex-shrink-0 rounded bg-white object-contain"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-[var(--foreground)]">{e.name}</span>
                          <div className="flex flex-wrap gap-x-2 text-[11px] text-[var(--muted-foreground)]">
                            <span className={PHASE[e.phase]}>
                              {e.phase}
                              {e.daysRemaining != null ? ` · ${e.daysRemaining}d left` : ''}
                            </span>
                            <span>
                              {e.effectiveFrom} → {e.effectiveTo}
                            </span>
                            <span>{e.required ? 'mandatory' : 'optional'}</span>
                            {e.offerTypes.length > 0 && <span>{e.offerTypes.join(', ')}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() => setDraft({ ...e, make: m.make, offerTypes: [...e.offerTypes] })}
                          className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => act('delete_event', { id: e.id }, `d-${e.id}`, 'Event removed')}
                          disabled={!!busy}
                          aria-label={`Remove ${e.name}`}
                          className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── add / edit event ── */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
              {draft.id ? 'Edit' : 'Add'} sales event — {draft.make}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Event name
                </label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Presidents Day Event"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Event mark URL <span className="font-normal">— transparent PNG</span>
                </label>
                <input
                  value={draft.logoUrl}
                  onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
                  placeholder="https://…/presidents-day.png"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                    Runs from
                  </label>
                  <input
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                    Runs to <span className="font-normal">— inclusive</span>
                  </label>
                  <input
                    type="date"
                    value={draft.effectiveTo}
                    onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Applies to <span className="font-normal">— none selected = every offer type</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_TYPES.map((t) => {
                    const on = draft.offerTypes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            offerTypes: on
                              ? draft.offerTypes.filter((x) => x !== t)
                              : [...draft.offerTypes, t],
                          })
                        }
                        aria-pressed={on}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          on
                            ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                            : 'bg-[var(--muted)] text-[var(--muted-foreground)] opacity-60 hover:opacity-100'
                        }`}
                      >
                        {t.replace('_', ' ')}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  The manufacturer mandates this mark during the window
                  <span className="block text-[11px] text-[var(--muted-foreground)]">
                    When mandatory, generation refuses any ad whose template has nowhere to render it, rather
                    than quietly producing one that isn’t claimable.
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ok = await act(
                    'save_event',
                    { ...draft, id: draft.id || undefined },
                    'save_event',
                    draft.id ? 'Event updated' : 'Event added',
                  );
                  if (ok) setDraft(null);
                }}
                disabled={!!busy || !draft.name.trim() || !draft.logoUrl.trim()}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy === 'save_event' ? 'Saving…' : 'Save event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
