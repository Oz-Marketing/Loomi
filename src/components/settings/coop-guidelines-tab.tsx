'use client';

/**
 * OEM Guidelines & Sales Events — the co-op team's surface, a Settings tab.
 *
 * Lives in Settings rather than under the Ad Generator because it isn't an
 * ad-building tool: it's the manufacturer reference the whole agency reads, and the
 * governance record behind every co-op claim. The tab only appears for agencies with
 * Automotive or Powersports accounts — see `useSettingsTabs`.
 *
 * MASTER-DETAIL, one manufacturer at a time. The first version stacked every make
 * down one page; at 24 makes that was an unreadable scroll where the three that
 * actually have rules were buried alphabetically. Now the left rail carries the
 * whole roster with its status, and the right pane shows only what's selected.
 *
 * Three things per make:
 *
 *   Guideline documents  the manufacturer's PDF, with its cover, watched by content
 *                        hash so a reissue is visible
 *   Automated checks     the rules transcribed from it, and how each ad template
 *                        stands against them
 *   Sales events         the campaign mark and the window it must appear in
 *
 * There is deliberately NO "mark reviewed" action. An earlier version demanded that
 * attestation before it would go quiet, which turned a library into a to-do list.
 * A document is simply what it is; when it changes, that's recorded as history and
 * the change is announced once.
 *
 * The page also doesn't edit rules or derive them from a document — see the header
 * of `guideline-docs.ts`. Briefly: a wrong rule silently costs a brand a month of
 * ads, so the machine's job is to say when to look, not to decide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { CoopPackEditor } from './coop-pack-editor';
import { CoopRuleReview } from './coop-rule-review';
import { toDraftRule, type DraftPack } from '@/lib/ad-generator/coop-rule-authoring';
import type { CoopRule, RequiredFieldEntry } from '@/lib/ad-generator/coop-rules';
import {
  ArrowPathIcon,
  BookOpenIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { HelpTip } from '@/components/ui/help-tip';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { GuidelineReader } from '@/components/ad-generator/guideline-reader';

// ── types (mirror the API's read model) ──

type EventState = 'covered' | 'ending_soon' | 'upcoming' | 'none';
type DocState = 'unfetched' | 'updated' | 'stored' | 'unreachable';

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
  /** ACCEPTED rules — what is enforced. */
  ruleCount: number;
  /** Drafted rules awaiting a decision in the review queue. Enforce nothing. */
  proposedCount: number;
  rejectedCount: number;
  /** Drafted "a person must fill this in" entries, for the review queue. */
  requiredFields?: RequiredFieldEntry[];
  warningCount: number;
  errorCount: number;
  updatedAt: string;
  /** The rules themselves, so an existing pack can be opened in the editor. */
  rules: CoopRule[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

interface GuidelineDocRow {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  contentHash: string | null;
  byteSize: number | null;
  pageCount: number | null;
  previewImage: string | null;
  previousHash: string | null;
  replacedAt: string | null;
  notes: string | null;
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

// ── presentation constants ──

const EVENT_STATE: Record<EventState, { label: string; className: string }> = {
  covered: { label: 'Event covered', className: 'bg-emerald-500/15 text-emerald-500' },
  ending_soon: { label: 'Event ending', className: 'bg-amber-500/15 text-amber-500' },
  upcoming: { label: 'Event upcoming', className: 'bg-blue-500/15 text-blue-500' },
  none: { label: 'No event', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]' },
};

const DOC_STATE: Record<DocState, { label: string; className: string }> = {
  stored: { label: 'On file', className: 'bg-emerald-500/15 text-emerald-500' },
  updated: { label: 'Updated', className: 'bg-blue-500/15 text-blue-500' },
  unfetched: { label: 'Not fetched', className: 'bg-[var(--muted)] text-[var(--muted-foreground)]' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/15 text-red-500' },
};

const PHASE: Record<EventRow['phase'], string> = {
  live: 'text-emerald-500',
  future: 'text-blue-500',
  past: 'text-[var(--muted-foreground)]',
};

const OFFER_TYPES = ['lease', 'apr', 'discount', 'sales_price'] as const;

/** KB below a megabyte, MB above — "6834 KB" is a number nobody reads as 6.7 MB. */
function fileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

/** States whose summary earns a line of its own, because it names a consequence. */
const EXPLAIN_STATE = new Set<DocState>(['updated', 'unreachable', 'unfetched']);

/**
 * A readable starting name from a filename, offered when adding a document.
 *
 * The real library is full of things like
 * "KiaDealerAdvertisingGuidelinesVer2.02025Apr638967455042013902.pdf" and
 * "14257276_2026 Q2 Hyundai...", so this strips the extension, the leading numeric
 * id some portals prepend, and separator punctuation. It's a starting point to edit,
 * not a guess anyone has to accept.
 */
function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{6,}[_-]\s*/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const emptyDocDraft = (make: string) => ({ make, title: '', sourceUrl: '', file: null as File | null });

const emptyEventDraft = (make: string) => ({
  id: '',
  make,
  name: '',
  logoUrl: '',
  effectiveFrom: '',
  effectiveTo: '',
  required: true,
  offerTypes: [] as string[],
});

/**
 * Per-document overflow menu. Follows the pattern in `forms/form-card` — a plain
 * popover with mousedown-outside and Escape to dismiss — rather than pulling in a
 * menu library for three items.
 *
 * Every handler stops propagation: the card behind it opens the reader on click, so
 * without that, choosing "Remove" would also open the document being removed.
 */
function DocMenu({
  label,
  disabled,
  className = '',
  downloadUrl,
  onRename,
  onReplace,
  onRemove,
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  /** Omitted for a document registered by hash with no stored copy. */
  downloadUrl?: string | null;
  onRename: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (text: string, onPick: () => void, danger = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        onPick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div ref={ref} className={`relative ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${label}`}
        title="More actions"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <EllipsisHorizontalIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="glass-dropdown absolute right-0 top-full z-50 mt-1 w-36 p-1 shadow-lg">
          {/* An anchor rather than a menu button, so cmd-click and "open in new
              tab" keep working — a button would have to reimplement both. */}
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              Download
            </a>
          )}
          {item('Rename', onRename)}
          {item('Replace', onReplace)}
          {item('Remove', onRemove, true)}
        </div>
      )}
    </div>
  );
}

export function CoopGuidelinesTab() {
  const { userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  const [makes, setMakes] = useState<MakeAssets[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [eventDraft, setEventDraft] = useState<ReturnType<typeof emptyEventDraft> | null>(null);
  const [docDraft, setDocDraft] = useState<ReturnType<typeof emptyDocDraft> | null>(null);
  const [pickingLogo, setPickingLogo] = useState(false);
  /** Mounted guard: `document.body` doesn't exist during SSR, and the modals below
   *  are portalled onto it. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [reading, setReading] = useState<GuidelineDocRow | null>(null);
  /** Where to land in the reader — set when arriving from a rule's citation. */
  const [readingAt, setReadingAt] = useState<{ page: number; query: string } | null>(null);
  /** Document currently being renamed inline, and the text being typed. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  /** Cover thumbnails, fetched per document on demand — the list omits them. */
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  /** Open editor: a DraftPack to edit, or `true` for a brand-new pack. */
  const [editing, setEditing] = useState<DraftPack | true | null>(null);

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

  /**
   * Documents change-watching can actually reach.
   *
   * The daily sweep re-downloads and re-fingerprints documents registered by WEB
   * ADDRESS. A document that was uploaded as a file has no address to re-fetch, and
   * its bytes cannot change on their own — so it is not watched, and never was. With
   * none on file the button is disabled rather than cheerfully reporting success
   * having checked nothing, which is what it used to do.
   */
  const watchable = useMemo(
    () => makes.reduce((n, m) => n + m.docs.filter((d) => d.sourceUrl).length, 0),
    [makes],
  );

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

  /** Upload a document. Multipart, so it can't share `act`'s JSON body. */
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
        else toast.success('Document uploaded');
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

  /** Lazily fetch one document's cover. The list response omits previews. */
  const loadCover = useCallback(
    async (docId: string) => {
      if (docId in covers) return;
      setCovers((c) => ({ ...c, [docId]: null }));
      try {
        const res = await fetch(`/api/ad-generator/oem-assets?docId=${encodeURIComponent(docId)}`);
        const json = await res.json();
        if (res.ok && json.doc?.previewImage) {
          setCovers((c) => ({ ...c, [docId]: json.doc.previewImage }));
        }
      } catch {
        // A missing cover is cosmetic — leave the placeholder.
      }
    },
    [covers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return makes;
    return makes.filter(
      (m) => m.make.toLowerCase().includes(q) || m.docs.some((d) => d.title.toLowerCase().includes(q)),
    );
  }, [makes, query]);

  const active = useMemo(
    () => filtered.find((m) => m.make === selected) ?? filtered[0] ?? null,
    [filtered, selected],
  );

  // Fetch covers for whichever make is on screen.
  useEffect(() => {
    if (!active) return;
    for (const d of active.docs) if (d.contentHash) void loadCover(d.id);
    // loadCover is intentionally excluded: it closes over `covers`, so including it
    // would re-run this effect on every cover that lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.make, active?.docs.length]);

  const attention = useMemo(
    () => ({
      docs: makes.flatMap((m) =>
        m.docs.filter((d) => d.state === 'unreachable').map((d) => ({ make: m.make, doc: d })),
      ),
      events: makes.filter((m) => m.eventState === 'ending_soon'),
    }),
    [makes],
  );

  if (!isAdmin) {
    return (
      <p className="py-8 text-sm text-[var(--muted-foreground)]">
        OEM guidelines and sales events are limited to admins.
      </p>
    );
  }

  const totalDocs = makes.reduce((n, m) => n + m.docs.length, 0);
  // Makes with at least one rule a person has ACCEPTED. A pack of unreviewed drafts
  // enforces nothing, so counting the row would overstate what is live.
  const withRules = makes.filter((m) => m.packs.some((p) => p.ruleCount > 0)).length;
  const awaitingReview = makes.reduce(
    (n, m) => n + m.packs.reduce((k, p) => k + p.proposedCount, 0),
    0,
  );

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">
            {/* "watched for changes" was not true: watching needs a web address, and
                every document here was uploaded as a file. Say what is actually the
                case rather than describing a capability nobody has. */}
            {makes.length} manufacturers · {totalDocs} guideline document{totalDocs === 1 ? '' : 's'} on file
            {watchable > 0 ? `, ${watchable} watched for changes` : ''} · {withRules} with rules Loomi enforces
            automatically
            {awaitingReview > 0 ? ` · ${awaitingReview} drafted rules awaiting review` : ''}
          </p>
        </div>
      </header>

      {/* ── the two things that actually go wrong ── */}
      {(attention.docs.length > 0 || attention.events.length > 0) && (
        <div className="mb-6 space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          {attention.docs.map(({ make, doc }) => (
            <p key={doc.id} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                <button onClick={() => setSelected(make)} className="font-medium underline">
                  {make}
                </button>{' '}
                — {doc.title} can no longer be fetched. {doc.checkError}
              </span>
            </p>
          ))}
          {attention.events.map((m) => (
            <p key={m.make} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                <button onClick={() => setSelected(m.make)} className="font-medium underline">
                  {m.make}
                </button>{' '}
                — {m.eventSummary}
              </span>
            </p>
          ))}
        </div>
      )}

      {makes.length === 0 && !loading ? (
        <div className="glass-card rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            No manufacturers yet. A make appears once it has a guideline document, a rule pack, an event, or an
            account configured for automation.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* ── master: the roster ── */}
          <aside className="lg:w-64 lg:flex-shrink-0">
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search manufacturers"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <nav className="max-h-[70vh] space-y-0.5 overflow-y-auto pr-1">
              {filtered.map((m) => {
                const isActive = active?.make === m.make;
                return (
                  <button
                    key={m.make}
                    onClick={() => setSelected(m.make)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive ? 'bg-[var(--primary)]/10 text-[var(--foreground)]' : 'hover:bg-[var(--muted)]/40'
                    }`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-xs ${isActive ? 'font-semibold' : 'font-medium text-[var(--foreground)]'}`}
                      >
                        {m.make}
                      </span>
                      <span className="block text-[10px] text-[var(--muted-foreground)]">
                        {m.docs.length || 'no'} doc{m.docs.length === 1 ? '' : 's'}
                        {m.packs.length > 0 && ' · rules'}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {/* Only real problems get a dot. "No pack" is the norm, not a fault. */}
                      {m.docs.some((d) => d.state === 'unreachable') && (
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="A document is unreachable" />
                      )}
                      {m.eventState === 'ending_soon' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Event window closing" />
                      )}
                      {m.packs.some((p) => p.verified) && (
                        <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-500" title="Rules enforced" />
                      )}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-2.5 py-3 text-xs text-[var(--muted-foreground)]">No match.</p>
              )}
            </nav>
          </aside>

          {/* ── detail: one make ── */}
          {active && (
            <section className="min-w-0 flex-1 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">{active.make}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${EVENT_STATE[active.eventState].className}`}
                >
                  {EVENT_STATE[active.eventState].label}
                </span>
                {active.packs.length === 0 ? (
                  <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                    no automated rules
                  </span>
                ) : active.unverified ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                    rules not approved
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                    rules enforced
                  </span>
                )}
              </div>

              {/* ── guideline documents ── */}
              <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                    Guideline documents
                    <HelpTip title="What these are for">
                      <p>
                        The manufacturer&rsquo;s own document, kept here so anyone at the agency can read it and so
                        a citation like &ldquo;§5e p.12&rdquo; can be checked.
                      </p>
                      <p>
                        Each is fingerprinted. Upload a newer edition over the top and Loomi notices the bytes
                        changed, keeps the old fingerprint as history, and tells the admins once. Documents with a
                        public URL are re-checked daily on their own.
                      </p>
                      <p>Nothing is read out of the document automatically — a person decides what a change means.</p>
                    </HelpTip>
                  </h3>
                  <button
                    onClick={() => setDocDraft(emptyDocDraft(active.make))}
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                  >
                    <PlusIcon className="h-3 w-3" /> Add document
                  </button>
                </div>

                {active.docs.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Nothing on file. Add {active.make}&rsquo;s guidelines and Loomi will tell you when they change.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {active.docs.map((d) => {
                      const ds = DOC_STATE[d.state];
                      const cover = covers[d.id];
                      return (
                        <div
                          key={d.id}
                          // The whole card opens the reader. A div rather than a
                          // button because it contains its own controls, and nesting
                          // buttons is invalid — hence the explicit role and key
                          // handling to keep it reachable without a mouse.
                          role="button"
                          tabIndex={0}
                          onClick={() => setReading(d)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setReading(d);
                            }
                          }}
                          className={`group/doc flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors hover:border-[var(--primary)]/60 hover:bg-[var(--muted)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${
                            d.state === 'unreachable' ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--border)]'
                          }`}
                        >
                          {/* cover */}
                          <div className="relative flex h-[104px] w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-white">
                            {cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cover} alt="" className="h-full w-full object-contain" />
                            ) : (
                              <DocumentTextIcon className="h-6 w-6 text-neutral-300" />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover/doc:opacity-100">
                              <BookOpenIcon className="h-5 w-5 text-white" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            {renaming?.id === d.id ? (
                              <input
                                autoFocus
                                value={renaming.title}
                                // Every interaction inside the editor has to stay off
                                // the card, or typing a space would open the reader.
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setRenaming({ id: d.id, title: e.target.value })}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Escape') setRenaming(null);
                                  if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                                // Commit on blur so Enter, Tab and clicking away all
                                // save — losing a rename because you clicked outside
                                // is the kind of small betrayal that stops people
                                // trusting inline editing.
                                onBlur={async () => {
                                  const next = renaming.title.trim();
                                  setRenaming(null);
                                  if (!next || next === d.title) return;
                                  await act('rename_doc', { docId: d.id, title: next }, `rn-${d.id}`, 'Renamed');
                                }}
                                className="w-full rounded border border-[var(--primary)] bg-[var(--background)] px-1.5 py-0.5 text-xs text-[var(--foreground)] outline-none"
                              />
                            ) : (
                              <div className="flex flex-wrap items-start gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenaming({ id: d.id, title: d.title });
                                  }}
                                  title="Click to rename"
                                  className="rounded text-left text-xs font-medium leading-snug text-[var(--foreground)] hover:underline"
                                >
                                  {d.title}
                                </button>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ds.className}`}>
                                  {ds.label}
                                </span>
                              </div>
                            )}
                            {EXPLAIN_STATE.has(d.state) && (
                              <p className="mt-1 text-[10px] leading-snug text-[var(--muted-foreground)]">
                                {d.summary}
                              </p>
                            )}
                            {d.notes && (
                              <p className="mt-1 text-[10px] italic leading-snug text-[var(--muted-foreground)]">
                                {d.notes}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--muted-foreground)]">
                              {d.pageCount && <span>{d.pageCount} pp</span>}
                              {fileSize(d.byteSize) && <span>{fileSize(d.byteSize)}</span>}
                              {d.contentHash && <span className="font-mono">{d.contentHash.slice(0, 8)}</span>}
                            </div>
                            {d.previousHash && d.replacedAt && (
                              <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                                replaced {d.replacedAt.slice(0, 10)}, was{' '}
                                <span className="font-mono">{d.previousHash.slice(0, 8)}</span>
                              </p>
                            )}
                            {/* Download moved into the menu with the rest of the
                                actions — leaving it inline as well would have put
                                the same command in two places on one card. */}
                            <div className="mt-2 flex items-center gap-2">
                              <DocMenu
                                className="ml-auto"
                                label={d.title}
                                disabled={!!busy}
                                downloadUrl={d.sourceUrl}
                                onRename={() => setRenaming({ id: d.id, title: d.title })}
                                onReplace={() => setDocDraft({ ...emptyDocDraft(active.make), title: d.title })}
                                onRemove={() => act('delete_doc', { docId: d.id }, `dd-${d.id}`, 'Document removed')}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── automated checks ── */}
              <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                  Automated checks
                  <HelpTip title="What Loomi enforces">
                    <p>
                      A small set of rules transcribed by hand from the document above, each with a citation. Only
                      a handful of manufacturers have these, on purpose.
                    </p>
                    <p>
                      Where a make has <strong>no</strong> pack, ads still generate — they just stay drafts and
                      never auto-approve, so a person sees every one. Nothing is skipped.
                    </p>
                    <p>
                      <strong>Approve for enforcement</strong> means a person checked the transcription against the
                      document. Until then findings only warn, so a half-finished transcription can&rsquo;t block a
                      brand&rsquo;s month.
                    </p>
                  </HelpTip>
                </h3>

                {active.packs.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--muted-foreground)]">
                      None for {active.make}. Ads generate as drafts for a person to approve.
                    </p>
                    <button
                      onClick={() => setEditing(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]"
                    >
                      <PlusIcon className="h-3 w-3" /> Write {active.make} rules
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {active.packs.map((p) => (
                      <div
                        key={p.id}
                        className={`rounded-xl border px-3 py-2.5 ${
                          p.verified ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--foreground)]">{p.version}</span>
                              <span className="text-[11px] text-[var(--muted-foreground)]">
                                {p.ruleCount} enforced · {p.errorCount} can block
                                {p.proposedCount > 0 ? ` · ${p.proposedCount} awaiting review` : ''}
                              </span>
                              <button
                                onClick={() =>
                                  setEditing({
                                    make: active.make,
                                    version: p.version,
                                    source: p.source ?? '',
                                    effectiveFrom: p.effectiveFrom,
                                    effectiveTo: p.effectiveTo,
                                    rules: p.rules.map(toDraftRule),
                                  })
                                }
                                className="text-[11px] font-medium text-[var(--primary)] hover:underline"
                              >
                                Edit rules
                              </button>
                            </div>
                            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                              {p.verified
                                ? `Approved${p.verifiedBy ? ` by ${p.verifiedBy}` : ''}${p.verifiedAt ? ` on ${p.verifiedAt.slice(0, 10)}` : ''} — these can block a non-compliant ad.`
                                : 'Not approved — findings only warn, and ads for this make stay drafts.'}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              act(
                                'set_verified',
                                { packId: p.id, verified: !p.verified },
                                `v-${p.id}`,
                                p.verified ? 'Approval removed' : 'Approved for enforcement',
                              )
                            }
                            disabled={!!busy}
                            className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                              p.verified
                                ? 'border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]/40'
                                : 'bg-[var(--primary)] text-white hover:opacity-90'
                            }`}
                          >
                            {p.verified ? (
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                            ) : (
                              <ShieldCheckIcon className="h-3.5 w-3.5" />
                            )}
                            {p.verified ? 'Approved' : 'Approve for enforcement'}
                          </button>
                        </div>

                        <CoopRuleReview
                          make={active.make}
                          packId={p.id}
                          packVerified={p.verified}
                          rules={p.rules}
                          requiredFields={p.requiredFields}
                          docs={active.docs.map((d) => ({
                            id: d.id,
                            title: d.title,
                            pageCount: d.pageCount,
                            sourceUrl: d.sourceUrl,
                          }))}
                          busy={!!busy}
                          onRead={(doc, page, query) => {
                            const full = active.docs.find((d) => d.id === doc.id);
                            if (!full) return;
                            setReadingAt({ page, query });
                            setReading(full);
                          }}
                          onDecided={load}
                        />
                      </div>
                    ))}

                    {/* template verdicts */}
                    {active.templateChecks.length > 0 && (
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                          Ad templates checked against these rules
                          <HelpTip title="Why once per template">
                            <p>
                              Most of these rules constrain the <strong>layout</strong> — brandmark present,
                              disclaimer big enough, logo in the permitted zone. That answer is a property of the
                              design, so it&rsquo;s the same for every ad built from it.
                            </p>
                            <p>
                              Checking once means a problem reads as &ldquo;this template needs fixing&rdquo; rather
                              than &ldquo;today&rsquo;s ads didn&rsquo;t generate&rdquo;. Re-runs by itself when the
                              design or the rules change.
                            </p>
                          </HelpTip>
                        </p>
                        {active.templateChecks.map((c) => (
                          <div key={c.templateId} className="mb-1.5 rounded-lg border border-[var(--border)] px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2">
                                {c.ok ? (
                                  <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                                ) : (
                                  <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 text-red-500" />
                                )}
                                <span className="font-mono text-[11px] text-[var(--foreground)]">{c.templateId}</span>
                                <span className="text-[11px] text-[var(--muted-foreground)]">
                                  {c.ok ? `passes ${c.ruleCount} layout rule(s)` : `${c.errorCount} to fix`}
                                </span>
                              </span>
                              <button
                                onClick={() =>
                                  act(
                                    'recheck_template',
                                    { templateId: c.templateId, make: active.make },
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
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── sales events ── */}
              <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                    Sales events
                    <HelpTip title="Campaign marks">
                      <p>
                        Most manufacturers require their event logo on any ad running inside the campaign window.
                        Ads generated in that window pick it up automatically.
                      </p>
                      <p>
                        <strong>Mandatory</strong> means generation refuses rather than produce an ad that
                        can&rsquo;t be claimed. The warning you want to act on is a window closing with nothing
                        queued behind it.
                      </p>
                    </HelpTip>
                  </h3>
                  <button
                    onClick={() => setEventDraft(emptyEventDraft(active.make))}
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                  >
                    <PlusIcon className="h-3 w-3" /> Add event
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">{active.eventSummary}</p>
                {active.events.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">No events on file.</p>
                ) : (
                  <div className="space-y-1.5">
                    {active.events.map((e) => (
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
                            onClick={() => setEventDraft({ ...e, make: active.make, offerTypes: [...e.offerTypes] })}
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
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── add / replace a document ── */}
      {/* Portalled for the same reason as the event modal below — see the note there. */}
      {mounted && docDraft && createPortal(
        (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-1 text-sm font-semibold text-[var(--foreground)]">
              {docDraft.title ? 'Replace' : 'Add'} guideline document — {docDraft.make}
            </h2>
            <p className="mb-4 text-[11px] text-[var(--muted-foreground)]">
              {docDraft.title
                ? 'Upload the newer edition. The old fingerprint is kept as history and the change is announced once.'
                : 'Loomi fingerprints the document and tells you when the manufacturer reissues it.'}
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Document name
                </label>
                <input
                  value={docDraft.title}
                  onChange={(e) => setDocDraft({ ...docDraft, title: e.target.value })}
                  placeholder="Subaru SAF Guidelines 2026"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  Keep the name identical to replace an existing document; change it to add a second one.
                </p>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                  Upload the file
                  <HelpTip title="Upload or link">
                    <p>
                      <strong>Uploading</strong> is the usual route — most manufacturer portals need a login, so
                      Loomi can&rsquo;t fetch them on a schedule.
                    </p>
                    <p>
                      <strong>A URL</strong> is better when the document has a stable public address, because then
                      Loomi re-checks it daily by itself. A Google Drive <em>share</em> link won&rsquo;t work: it
                      returns a web page rather than the file.
                    </p>
                    <p>PDF or Word, up to 80 MB.</p>
                  </HelpTip>
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    // Offer the filename as the name, tidied — but never overwrite
                    // something already typed, and never on a Replace (where the
                    // title is the key that finds the document being replaced).
                    const suggested =
                      file && !docDraft.title.trim() ? titleFromFilename(file.name) : docDraft.title;
                    setDocDraft({ ...docDraft, file, title: suggested });
                  }}
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
                  Public URL <span className="font-normal">— re-checked daily</span>
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
                  // A file, when given, goes through the multipart route — it uploads,
                  // hashes and registers as one operation, so a register entry can't
                  // end up pointing at a document that was never stored.
                  const ok = docDraft.file
                    ? await uploadDoc(docDraft.make, docDraft.title, docDraft.file)
                    : await act(
                        'register_doc',
                        { make: docDraft.make, title: docDraft.title, sourceUrl: docDraft.sourceUrl },
                        'reg-doc',
                        'Document added',
                      );
                  if (ok) setDocDraft(null);
                }}
                disabled={!!busy || !docDraft.title.trim() || (!docDraft.file && !docDraft.sourceUrl.trim())}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy === 'upload-doc' ? 'Uploading…' : docDraft.file ? 'Upload' : 'Add'}
              </button>
            </div>
          </div>
        </div>
        ), document.body)}

      {/* ── add / edit event ── */}
      {/* PORTALLED TO THE BODY, like the reader above it, and for the same reason:
          `position: fixed` resolves against the nearest ancestor carrying a
          transform, filter, backdrop-filter or containment — and this page is built
          from glass cards that all use backdrop-blur. Rendered in place, `inset-0`
          sized itself to whichever card happened to contain it instead of the
          viewport, so the modal appeared boxed inside the panel rather than over the
          screen.

          z-50 is deliberately NOT raised to the drill-in layer (260). The media
          picker opens FROM this modal and sits at z-[220]; at 260 this overlay would
          cover the picker and choosing an event mark would become impossible. */}
      {mounted && eventDraft && createPortal(
        (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
              {eventDraft.id ? 'Edit' : 'Add'} sales event — {eventDraft.make}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Event name
                </label>
                <input
                  value={eventDraft.name}
                  onChange={(e) => setEventDraft({ ...eventDraft, name: e.target.value })}
                  placeholder="Presidents Day Event"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>

              {/* Event mark — from the media library, which is where these already live. */}
              <div>
                <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                  Event mark
                  <HelpTip title="The campaign logo">
                    <p>
                      Pick it from the media library, or paste a URL if it&rsquo;s hosted elsewhere. A transparent
                      PNG works best — it composites over any template background.
                    </p>
                  </HelpTip>
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-white">
                    {eventDraft.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={eventDraft.logoUrl} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <PhotoIcon className="h-5 w-5 text-neutral-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <button
                      onClick={() => setPickingLogo(true)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40"
                    >
                      <PhotoIcon className="h-3.5 w-3.5" />
                      Choose from media library
                    </button>
                    <input
                      value={eventDraft.logoUrl}
                      onChange={(e) => setEventDraft({ ...eventDraft, logoUrl: e.target.value })}
                      placeholder="…or paste a https:// URL"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                    Starts
                  </label>
                  <input
                    type="date"
                    value={eventDraft.effectiveFrom}
                    onChange={(e) => setEventDraft({ ...eventDraft, effectiveFrom: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Ends</label>
                  <input
                    type="date"
                    value={eventDraft.effectiveTo}
                    onChange={(e) => setEventDraft({ ...eventDraft, effectiveTo: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={eventDraft.required}
                  onChange={(e) => setEventDraft({ ...eventDraft, required: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-[var(--border)]"
                />
                The manufacturer requires this mark during the window
              </label>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                  Limit to offer types <span className="font-normal">— none selected means all</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_TYPES.map((t) => {
                    const on = eventDraft.offerTypes.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() =>
                          setEventDraft({
                            ...eventDraft,
                            offerTypes: on
                              ? eventDraft.offerTypes.filter((x) => x !== t)
                              : [...eventDraft.offerTypes, t],
                          })
                        }
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          on
                            ? 'bg-[var(--primary)] text-white'
                            : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEventDraft(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ok = await act(
                    'save_event',
                    {
                      id: eventDraft.id || undefined,
                      make: eventDraft.make,
                      name: eventDraft.name,
                      logoUrl: eventDraft.logoUrl,
                      effectiveFrom: eventDraft.effectiveFrom,
                      effectiveTo: eventDraft.effectiveTo,
                      required: eventDraft.required,
                      offerTypes: eventDraft.offerTypes,
                    },
                    'save-event',
                    eventDraft.id ? 'Event updated' : 'Event added',
                  );
                  if (ok) setEventDraft(null);
                }}
                disabled={
                  !!busy ||
                  !eventDraft.name.trim() ||
                  !eventDraft.logoUrl.trim() ||
                  !eventDraft.effectiveFrom ||
                  !eventDraft.effectiveTo
                }
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
        ), document.body)}

      {/* ── read a document in place ── */}
      {reading && (
        <GuidelineReader
          docId={reading.id}
          title={reading.title}
          pageCount={reading.pageCount}
          sourceUrl={reading.sourceUrl}
          initialPage={readingAt?.page}
          initialQuery={readingAt?.query}
          onClose={() => {
            setReading(null);
            setReadingAt(null);
          }}
        />
      )}

      {/* Media library picker for the event mark. Rendered outside the event modal's
          markup but above it in z-order, so choosing a logo doesn't lose the draft. */}
      {pickingLogo && eventDraft && (
        <MediaPickerModal
          onSelect={(url) => {
            setEventDraft({ ...eventDraft, logoUrl: url });
            setPickingLogo(false);
          }}
          onClose={() => setPickingLogo(false)}
          showCategories
          category="oem"
          uploadCategory="oem"
        />
      )}

    {editing && (
      <CoopPackEditor
        make={active?.make ?? ''}
        initial={editing === true ? undefined : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { void load(); }}
      />
    )}

    </div>
  );
}
