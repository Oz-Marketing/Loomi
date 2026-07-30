'use client';

/**
 * OEM Guidelines & Sales Events (admin) — the co-op team's surface.
 *
 * Four things per manufacturer, together because they're one job: versioned,
 * time-boxed, co-op-owned, and consequential when stale.
 *
 *   Source documents  the guideline PDF, tracked by content hash — the mechanism
 *                     that says "this changed, go look"
 *   Transcribed rules the machine-checkable pack + the verified toggle
 *   Template checks   each template's standing against those rules, computed once
 *   Sales events      the campaign mark + its window + whether the OEM mandates it
 *
 * The page leads with STALENESS rather than listings, because the failures are all
 * of that shape: a document reissued and nobody noticed; an event window closing
 * with no successor queued, after which ads silently drop a mandated mark.
 *
 * What this page deliberately does NOT do is edit rules or derive them from a
 * document. See `guideline-docs.ts` for why — briefly: a wrong rule silently costs
 * a brand a month of ads, so the human stays in the loop and the machine's job is
 * to say when to look.
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
import { HelpTip } from '@/components/ui/help-tip';

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

type DocState = 'unfetched' | 'unreviewed' | 'current' | 'changed' | 'unreachable';

interface GuidelineDocRow {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  contentHash: string | null;
  byteSize: number | null;
  reviewedHash: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  checkedAt: string | null;
  checkError: string | null;
  state: DocState;
  summary: string;
}

interface TemplateCheckFinding {
  ruleId: string;
  severity: 'error' | 'warning';
  description: string;
  citation?: string;
  offerType: string;
}

interface TemplateCheckRow {
  templateId: string;
  packVersion: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: TemplateCheckFinding[];
  offerTypes: string[];
  ruleCount: number;
  checkedAt: string;
  checkedBy: string | null;
}

interface MakeAssets {
  make: string;
  packs: PackRow[];
  events: EventRow[];
  eventState: EventState;
  eventSummary: string;
  unverified: boolean;
  docs: GuidelineDocRow[];
  docsChanged: boolean;
  templateChecks: TemplateCheckRow[];
}

/** KB below a megabyte, MB above — "6834 KB" is a number nobody reads as 6.7 MB. */
function fileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * States whose summary sentence earns its place, because it names an action.
 * `unreviewed` and `current` are fully carried by the badge, and repeating a
 * sentence across 33 rows turns the page into a wall nobody reads.
 */
const EXPLAIN_STATE = new Set<DocState>(['changed', 'unreachable', 'unfetched']);

const DOC_STATE: Record<DocState, { label: string; className: string }> = {
  current: { label: 'Reviewed', className: 'bg-emerald-500/15 text-emerald-500' },
  changed: { label: 'CHANGED', className: 'bg-amber-500/15 text-amber-500' },
  unreviewed: { label: 'Not reviewed', className: 'bg-blue-500/15 text-blue-500' },
  unfetched: { label: 'Not fetched', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/15 text-red-500' },
};

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

/** Blank draft for the "register document" form. */
const emptyDocDraft = (make: string) => ({ make, title: '', sourceUrl: '', file: null as File | null });

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
  const [docDraft, setDocDraft] = useState<ReturnType<typeof emptyDocDraft> | null>(null);

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

  /**
   * Upload a document through the multipart route. Separate from `act` because that
   * one posts JSON; sharing it would mean branching on body type in the caller.
   */
  const uploadDoc = useCallback(
    async (make: string, title: string, file: File) => {
      setBusy('upload-doc');
      try {
        const body = new FormData();
        body.set('make', make);
        body.set('title', title);
        body.set('file', file);
        const res = await fetch('/api/ad-generator/oem-assets/upload', { method: 'POST', body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (json.unchanged) toast.info(json.message);
        // Registration works without S3 — the hash still drives change detection —
        // so surface that the file itself wasn't kept rather than implying it was.
        else if (json.warning) toast.warning(json.warning);
        else toast.success('Document uploaded and registered');
        await load();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
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
  // The register's whole purpose, hoisted to the top of the page: a document that
  // moved after someone reviewed it, or one that can no longer be fetched at all.
  const changedDocs = makes.flatMap((m) =>
    m.docs.filter((d) => d.state === 'changed' || d.state === 'unreachable').map((d) => ({ make: m.make, doc: d })),
  );

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
            Per manufacturer: the guideline document Loomi watches for changes, the rules transcribed from it,
            how each template stands against those rules, and the sales-event marks that must appear on ads
            during a campaign window.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              act('refresh_docs', {}, 'refresh-docs', 'Documents re-fetched and compared')
            }
            disabled={!!busy || loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${busy === 'refresh-docs' ? 'animate-spin' : ''}`} /> Check documents
            now
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </header>

      {/* ── coverage at a glance ──
          With two dozen makes the page is long, and the ones that matter aren't
          alphabetically first. These four numbers answer "where do we stand" without
          scrolling, and the gap between documents and packs is the honest headline:
          holding a guideline is not the same as checking anything against it. */}
      {makes.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Makes', value: makes.length, hint: 'with a document, pack, event or automation config' },
            {
              label: 'Documents watched',
              value: makes.reduce((n, m) => n + m.docs.length, 0),
              hint: 'tracked by content hash',
            },
            {
              label: 'Awaiting review',
              value: makes.reduce((n, m) => n + m.docs.filter((d) => d.state !== 'current').length, 0),
              hint: 'no baseline set yet, so a change would go unnoticed',
            },
            {
              label: 'Rules transcribed',
              value: makes.filter((m) => m.packs.length > 0).length,
              hint: 'makes with a machine-checkable pack',
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] px-3 py-2.5" title={s.hint}>
              <p className="text-lg font-semibold text-[var(--foreground)]">{s.value}</p>
              <p className="text-[11px] text-[var(--muted-foreground)]">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── a guideline moved under us: the register's reason to exist ── */}
      {changedDocs.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <ExclamationTriangleIcon className="h-4 w-4" />
            {changedDocs.length} guideline document{changedDocs.length > 1 ? 's need' : ' needs'} attention
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-amber-600/90 dark:text-amber-400/90">
            {changedDocs.map(({ make, doc }) => (
              <li key={doc.id}>
                <span className="font-medium">{make}</span> — {doc.title}: {doc.summary}
              </li>
            ))}
          </ul>
        </div>
      )}

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

              {/* ── source documents ── */}
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Source documents
                  <HelpTip title="How these stay current">
                    <p>
                      Each document is tracked by a <strong>content hash</strong>. When the manufacturer reissues
                      it, the hash stops matching the one that was last reviewed and it shows as{' '}
                      <strong>CHANGED</strong>.
                    </p>
                    <p>
                      Nothing is re-derived automatically. Transcribing rules from a document is slow and easy to
                      get wrong, and a wrong rule silently costs a brand a month of ads — so a person reads what
                      changed and decides whether any template needs work.
                    </p>
                    <p>
                      URL-backed documents are re-fetched daily at 07:00 UTC. &ldquo;Mark reviewed&rdquo; sets the
                      baseline to what the document says right now.
                    </p>
                  </HelpTip>
                </h3>
                <button
                  onClick={() => setDocDraft(emptyDocDraft(m.make))}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                >
                  <PlusIcon className="h-3 w-3" /> Register document
                </button>
              </div>
              {m.docs.length === 0 ? (
                <p className="mb-4 text-xs text-[var(--muted-foreground)]">
                  No document registered. Nothing will tell you when {m.make} reissues its guidelines.
                </p>
              ) : (
                <div className="mb-4 space-y-1.5">
                  {m.docs.map((d) => {
                    const ds = DOC_STATE[d.state];
                    return (
                      <div
                        key={d.id}
                        className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 ${
                          d.state === 'changed' || d.state === 'unreachable'
                            ? 'border-amber-500/30 bg-amber-500/5'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-[var(--foreground)]">{d.title}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ds.className}`}>
                              {ds.label}
                            </span>
                            {d.sourceUrl && (
                              <a
                                href={d.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-medium text-[var(--primary)] hover:underline"
                              >
                                open →
                              </a>
                            )}
                          </div>
                          {EXPLAIN_STATE.has(d.state) && (
                            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{d.summary}</p>
                          )}
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--muted-foreground)]">
                            {d.contentHash && <span className="font-mono">{d.contentHash.slice(0, 12)}</span>}
                            {fileSize(d.byteSize) && <span>{fileSize(d.byteSize)}</span>}
                            {d.checkedAt && <span>checked {d.checkedAt.slice(0, 10)}</span>}
                            {d.reviewedBy && (
                              <span>
                                reviewed by {d.reviewedBy}
                                {d.reviewedAt ? ` on ${d.reviewedAt.slice(0, 10)}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          {d.state !== 'current' && d.state !== 'unfetched' && (
                            <button
                              onClick={() =>
                                act('mark_doc_reviewed', { docId: d.id }, `dr-${d.id}`, 'Baseline updated')
                              }
                              disabled={!!busy}
                              className="flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <CheckCircleIcon className="h-3.5 w-3.5" /> Mark reviewed
                            </button>
                          )}
                          <button
                            onClick={() => act('delete_doc', { docId: d.id }, `dd-${d.id}`, 'Document removed')}
                            disabled={!!busy}
                            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                            title="Remove from the register"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── guideline packs ── */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Transcribed rules
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

              {/* ── design-time template verdicts ── */}
              {m.templateChecks.length > 0 && (
                <>
                  <h3 className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Template layout checks
                    <HelpTip title="Why these are per template">
                      <p>
                        Most co-op rules constrain the <strong>layout</strong> — brandmark present, disclaimer big
                        enough, logo in the permitted zone. That answer is a property of the design, so it is the
                        same for every ad built from it.
                      </p>
                      <p>
                        Checking it once means a violation reads as &ldquo;this template needs fixing&rdquo; instead
                        of &ldquo;today&rsquo;s ads didn&rsquo;t generate&rdquo;. Rules about wording still run on
                        every ad, because the disclaimer comes from the manufacturer&rsquo;s own text per offer.
                      </p>
                      <p>Re-runs automatically when the design or the rule pack changes.</p>
                    </HelpTip>
                  </h3>
                  <div className="mb-4 space-y-1.5">
                    {m.templateChecks.map((c) => (
                      <div
                        key={c.templateId}
                        className={`rounded-lg border px-3 py-2 ${
                          c.ok ? 'border-[var(--border)]' : 'border-red-500/30 bg-red-500/5'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {c.ok ? (
                              <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                            ) : (
                              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 text-red-500" />
                            )}
                            <span className="font-mono text-[11px] text-[var(--foreground)]">{c.templateId}</span>
                            <span className="text-[11px] text-[var(--muted-foreground)]">
                              {c.ruleCount === 0
                                ? 'no layout rules'
                                : `${c.ruleCount} rule(s) · ${c.errorCount} blocking · ${c.warningCount} advisory`}
                            </span>
                            {c.offerTypes.length > 0 && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {c.offerTypes.join(', ')}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              act(
                                'recheck_template',
                                { templateId: c.templateId, make: m.make },
                                `rc-${c.templateId}`,
                                'Template re-checked',
                              )
                            }
                            disabled={!!busy}
                            className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
                          >
                            <ArrowPathIcon
                              className={`h-3 w-3 ${busy === `rc-${c.templateId}` ? 'animate-spin' : ''}`}
                            />
                            Re-check
                          </button>
                        </div>
                        {c.findings.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 border-t border-[var(--border)] pt-1.5">
                            {c.findings.map((f, i) => (
                              <li
                                key={`${f.ruleId}-${f.offerType}-${i}`}
                                className={`text-[11px] ${f.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`}
                              >
                                {f.description}
                                {f.offerType && f.offerType !== 'any' && (
                                  <span className="text-[var(--muted-foreground)]"> — {f.offerType} only</span>
                                )}
                                {f.citation && (
                                  <span className="text-[var(--muted-foreground)]"> ({f.citation})</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                          Pack {c.packVersion} · checked {c.checkedAt.slice(0, 10)}
                          {c.checkedBy ? ` by ${c.checkedBy}` : ' automatically'}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
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

      {/* ── register a source document ── */}
      {docDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-1 text-sm font-semibold text-[var(--foreground)]">
              Register guideline document — {docDraft.make}
            </h2>
            <p className="mb-4 text-[11px] text-[var(--muted-foreground)]">
              Loomi hashes the document and tells you when the manufacturer reissues it. It does not read the rules
              out of it.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Title</label>
                <input
                  value={docDraft.title}
                  onChange={(e) => setDocDraft({ ...docDraft, title: e.target.value })}
                  placeholder="Subaru SAF Guidelines"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                  Upload the document
                  <HelpTip title="Upload or link — either works">
                    <p>
                      <strong>Uploading</strong> is the usual route, because most manufacturer portals sit behind a
                      login and can&rsquo;t be fetched on a schedule. The file is stored in the Loomi media library
                      so anyone at the agency can open it, and re-uploading a newer edition is how a reissue enters
                      the register.
                    </p>
                    <p>
                      <strong>A URL</strong> is better when the document has a stable public address — Loomi
                      re-fetches it daily and spots a change without anyone doing anything. A Google Drive{' '}
                      <em>share</em> link won&rsquo;t work: it returns an HTML page rather than the file, so its
                      hash churns whenever Drive restyles that page.
                    </p>
                    <p>PDF or Word, up to 80 MB.</p>
                  </HelpTip>
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,application/pdf"
                  onChange={(e) => setDocDraft({ ...docDraft, file: e.target.files?.[0] ?? null })}
                  className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--muted)] file:px-2 file:py-1 file:text-xs file:font-medium file:text-[var(--foreground)] focus:border-[var(--primary)]"
                />
                {docDraft.file && (
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    {docDraft.file.name} — {(docDraft.file.size / 1048576).toFixed(1)} MB
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">or</span>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Document URL <span className="font-normal">— re-fetched daily</span>
                </label>
                <input
                  value={docDraft.sourceUrl}
                  onChange={(e) => setDocDraft({ ...docDraft, sourceUrl: e.target.value })}
                  placeholder="https://…/saf-guidelines.pdf"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDocDraft(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // A file, when given, goes through the multipart route — it does the
                  // upload, the hash and the register as one operation, so a register
                  // entry can't end up pointing at a document that was never stored.
                  if (docDraft.file) {
                    const ok = await uploadDoc(docDraft.make, docDraft.title, docDraft.file);
                    if (ok) setDocDraft(null);
                    return;
                  }
                  const ok = await act(
                    'register_doc',
                    { make: docDraft.make, title: docDraft.title, sourceUrl: docDraft.sourceUrl },
                    'reg-doc',
                    'Document registered',
                  );
                  if (ok) setDocDraft(null);
                }}
                disabled={
                  !!busy || !docDraft.title.trim() || (!docDraft.file && !docDraft.sourceUrl.trim())
                }
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {docDraft.file ? 'Upload & register' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}

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
