'use client';

/**
 * THE PROOF SHEET — every offer type this template serves × every board it
 * defines, drawn by the real renderer and checked by the real compliance gate.
 *
 * WHY A COMPONENT AND NOT A PAGE. It began as a page, and the page is still there
 * for a link somebody wants to send. But the sheet's reader is a designer who is
 * MID-EDIT: they open it, find the board where the disclaimer is 7px, and go back
 * to move it. A page in the app shell made that a new tab, a sidebar, an account
 * switcher and a trip back — the builder's own chrome replaced by the app's, for a
 * read that is about the design in front of them. So the primary surface is a modal
 * over the editor, and this is the sheet both of them draw.
 *
 * The design comes from the SAVED template row, so what is drawn is what automation
 * would use. The builder autosaves, so the two are never far apart — but a sheet
 * that quietly proved an unsaved draft would be worse than useless.
 *
 * Everything shown is computed server-side by
 * POST /api/ad-generator/templates-doc/[id]/proof, which shares `buildProofSheet`
 * with nothing else and `preflight` with the generation pipeline. See
 * docs/ad-generator-archetypes.md §8 Phase 4.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  NoSymbolIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { HelpTip } from '@/components/ui/help-tip';
import { Collapse } from '@/components/ui/collapse';
import { brandLogoData } from '@/lib/ad-generator/brand-logos';
import { offerTypePill, offerTypeShort } from '@/lib/ad-generator/offer-type-style';
import type {
  ProofBoard,
  ProofNote,
  ProofRow,
  ProofSheet,
  ProofTemplateFault,
} from '@/lib/ad-generator/proof-sheet';
import type { PreflightIssue } from '@/lib/ad-generator/preflight';
import type { AdData, AdSize } from '@/lib/ad-generator/types';

interface Sheet extends ProofSheet {
  templateName: string;
  make: string;
  hasPack: boolean;
  packVerified: boolean;
}

/**
 * The display box every board is scaled to fit.
 *
 * ONE shared scale for every board on the sheet, not one per board: the whole
 * point of seeing them together is that a 1200×628 reads as three times the width
 * of a 300×250. Scaling each to fill its own cell makes the Facebook board look
 * weak next to the KSL tower, which is a lie about the design.
 */
const CELL = { w: 300, h: 300 };

/** The scale that fits every board in the sheet inside one cell. Never upscales. */
function sheetScale(sizes: { width: number; height: number }[]): number {
  if (!sizes.length) return 1;
  return Math.min(1, ...sizes.map((s) => Math.min(CELL.w / s.width, CELL.h / s.height)));
}

function Severity({ issues }: { issues: PreflightIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (!issues.length) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {errors > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[10px] font-medium text-red-400">
          <XCircleIcon className="h-3 w-3" />
          {errors}
        </span>
      )}
      {warnings > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400">
          <ExclamationTriangleIcon className="h-3 w-3" />
          {warnings}
        </span>
      )}
    </span>
  );
}

/**
 * How each note tone is drawn.
 *
 * The notes used to be a stack of identical grey sentences, which meant the one
 * that says "this cannot be exported" read exactly like the one that says "the
 * photo is blank on purpose". Tone, icon and a two-word badge give the reader the
 * severity before they read the sentence — and the list is already sorted so the
 * blocking ones come first.
 */
const NOTE_TONE = {
  blocking: {
    Icon: NoSymbolIcon,
    ring: 'border-red-500/30 bg-red-500/[0.07]',
    accent: 'text-red-400',
    badge: 'border-red-500/40 bg-red-500/10 text-red-400',
  },
  caution: {
    Icon: ExclamationTriangleIcon,
    ring: 'border-amber-500/30 bg-amber-500/[0.06]',
    accent: 'text-amber-400',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  },
  context: {
    Icon: InformationCircleIcon,
    ring: 'border-[var(--border)] bg-[var(--muted)]/30',
    accent: 'text-[var(--muted-foreground)]',
    badge: 'border-[var(--border)] text-[var(--muted-foreground)]',
  },
} as const;

/**
 * One design fault: what is wrong, which of the twenty ads it is about, and where
 * the claim comes from.
 *
 * ONE LINE PER FAULT, however many boards it lands on. A twenty-two-board template
 * that pins its disclaimer too small fails identically on all twenty-two, and the
 * sheet used to print that sentence twenty-two times with a different board name in
 * it — thirty-five "blocking faults" that were really three. The boards are chips
 * under the sentence instead, each carrying its own measurement where the audit
 * took one, so nothing is lost but the repetition.
 */
function Fault({ fault, sizes }: { fault: ProofTemplateFault; sizes: AdSize[] }) {
  const boardLabel = (id: string) =>
    sizes.find((s) => s.id === id)?.label.replace(/\s*\(.*\)$/, '') ?? id;
  // Every board on the sheet, and nothing per-board to say about them: state the
  // fact instead of printing a chip for each, which is the same sentence again.
  const allBoards =
    fault.sizes.length > 1 && fault.sizes.length === sizes.length && !fault.sizeDetail;
  return (
    <li className="text-[12px] leading-snug">
      <span className={fault.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
        {fault.description}
      </span>
      {/* Offer types stay on the sentence's line — there are at most four, and
          "for a lease ad" belongs with the claim. */}
      {fault.offerTypes.length > 0 && (
        <span className="ml-1.5 inline-flex flex-wrap items-center gap-1">
          {fault.offerTypes.map((t) => (
            <span
              key={t}
              className="rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight"
              style={offerTypePill(t)}
            >
              {offerTypeShort(t)}
            </span>
          ))}
        </span>
      )}
      {/* Where the claim comes from. A manufacturer's rule cites its own document;
          the house audit says so instead of borrowing that authority. */}
      {fault.citation ? (
        <span className="ml-1 text-[var(--muted-foreground)]">({fault.citation})</span>
      ) : (
        fault.source === 'audit' && (
          <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]/70">
            design check
          </span>
        )
      )}
      {fault.fix && (
        <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{fault.fix}</span>
      )}
      {/* The boards, on their own row: with seventeen of them this wraps, and
          wrapping mid-sentence made the fault itself hard to find. */}
      {fault.sizes.length > 0 && (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {allBoards ? (
            <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[9px] leading-tight text-[var(--muted-foreground)]">
              every board ({sizes.length})
            </span>
          ) : (
            fault.sizes.map((id) => (
              <span
                key={id}
                className="rounded-full border border-[var(--border)] px-1.5 py-px font-mono text-[9px] leading-tight text-[var(--muted-foreground)]"
              >
                {boardLabel(id)}
                {fault.sizeDetail?.[id] && (
                  <span
                    className={`ml-1 font-sans font-medium ${fault.severity === 'error' ? 'text-red-400/80' : 'text-amber-400/80'}`}
                  >
                    {fault.sizeDetail[id]}
                  </span>
                )}
              </span>
            ))
          )}
        </span>
      )}
    </li>
  );
}

/**
 * A group of faults behind a disclosure.
 *
 * Blocking and non-blocking are separate groups because they call for different
 * things: one is "this cannot ship", the other is "look at this when you can".
 * Thirteen findings in one undifferentiated list made the reader do that sorting
 * themselves — and blocking opens by default for the same reason.
 */
function FaultGroup({
  title,
  hint,
  faults,
  sizes,
  tone,
  defaultOpen,
}: {
  /** SINGULAR — the count is prefixed and the plural added. Collapsing the list
   *  made a one-fault group reachable, and it read "1 blocking design faults". */
  title: string;
  hint: string;
  faults: ProofTemplateFault[];
  sizes: AdSize[];
  tone: 'blocking' | 'warning';
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!faults.length) return null;
  const style =
    tone === 'blocking'
      ? { ring: 'border-red-500/30 bg-red-500/[0.07]', accent: 'text-red-400', Icon: XCircleIcon }
      : { ring: 'border-amber-500/30 bg-amber-500/[0.06]', accent: 'text-amber-400', Icon: ExclamationTriangleIcon };
  return (
    <section className={`rounded-lg border ${style.ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <style.Icon className={`h-4 w-4 shrink-0 ${style.accent}`} />
        <span className="text-sm font-semibold text-[var(--foreground)]">
          {faults.length} {title}
          {faults.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto hidden text-[11px] text-[var(--muted-foreground)] sm:inline">{hint}</span>
      </button>
      <Collapse open={open}>
        <ul className="space-y-2.5 px-4 pb-3.5 pl-[2.3rem]">
          {faults.map((f) => (
            <Fault key={`${f.source}-${f.ruleId}-${f.description}`} fault={f} sizes={sizes} />
          ))}
        </ul>
      </Collapse>
    </section>
  );
}

function Note({ note }: { note: ProofNote }) {
  const tone = NOTE_TONE[note.tone];
  return (
    <li className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${tone.ring}`}>
      <tone.Icon className={`mt-px h-4 w-4 shrink-0 ${tone.accent}`} />
      <div className="min-w-0">
        <span
          className={`mb-0.5 mr-2 inline-block rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${tone.badge}`}
        >
          {note.label}
        </span>
        <span
          className={`text-[12.5px] leading-relaxed ${note.tone === 'context' ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}
        >
          {note.text}
        </span>
      </div>
    </li>
  );
}

/** One ad: the real render, scaled down, with anything wrong with it underneath. */
function Board({ board, scale }: { board: ProofBoard; scale: number }) {
  const w = Math.round(board.width * scale);
  const h = Math.round(board.height * scale);
  return (
    <figure className="m-0 flex shrink-0 flex-col items-center gap-1.5" style={{ width: w }}>
      <div
        className="overflow-hidden rounded-sm bg-white shadow-[0_8px_28px_-8px_rgba(0,0,0,0.45)]"
        style={{ width: w, height: h }}
      >
        {/*
          `srcDoc` + `pointer-events:none`: the sheet is a contact print, not an
          editor. The iframe renders at the board's REAL pixel size and is scaled
          with a transform, so type sets exactly as it will in the export —
          rendering into a small iframe instead would re-fit every text box.
        */}
        <iframe
          title={`${board.label} — ${board.width}×${board.height}`}
          srcDoc={board.html}
          width={board.width}
          height={board.height}
          className="pointer-events-none block border-0"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      </div>
      <figcaption className="flex items-center gap-1.5 text-center font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
        <span>
          {board.width}×{board.height}
        </span>
        <Severity issues={board.issues} />
      </figcaption>
    </figure>
  );
}

/** One offer type, across every board. */
function Row({ row, scale }: { row: ProofRow; scale: number }) {
  // Issues that belong to the offer type rather than to one board — they would
  // otherwise repeat under all five.
  const dataIssues = row.issues.filter((i) => !i.sizes?.length);
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] py-5 last:border-b-0 lg:flex-row lg:gap-6">
      <div className="flex shrink-0 items-start gap-2 lg:w-[150px] lg:flex-col lg:gap-1.5">
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
          style={{
            color: row.accent,
            borderColor: `${row.accent}66`,
            backgroundColor: `${row.accent}1f`,
          }}
        >
          {row.label}
        </span>
        {row.ok ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <CheckCircleIcon className="h-3.5 w-3.5" />
            Clears
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-400">
            <XCircleIcon className="h-3.5 w-3.5" />
            Blocked
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-end gap-5 overflow-x-auto">
          {row.boards.map((b) => (
            <Board key={b.sizeId} board={b} scale={scale} />
          ))}
        </div>
        {dataIssues.length > 0 && (
          <ul className="mt-3 space-y-1">
            {dataIssues.map((i, n) => (
              <li
                key={`${i.code}-${i.field ?? n}`}
                className={`text-[11px] leading-snug ${i.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}
              >
                {i.message}
                {i.citation && (
                  <span className="ml-1 text-[var(--muted-foreground)]">({i.citation})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The sheet itself — the header line, the notes, the design faults and the grid.
 *
 * Owns its own fetch, because both callers want the same thing: ask the server to
 * build the sheet from the SAVED row, and re-ask when the designer presses
 * Re-check after fixing something. `layout` is the only difference between them:
 * a page has the app shell around it, a modal has its own.
 */
export function ProofSheetView({
  templateId,
  layout = 'page',
  onOpenInTab,
}: {
  templateId: string;
  /** `modal` drops the outer padding — the dialog supplies its own. */
  layout?: 'page' | 'modal';
  /** Offered in the modal only: the same sheet as a linkable page. */
  onOpenInTab?: () => void;
}) {
  const { accountData, accountKey } = useAccount();

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sampleVehicle, setSampleVehicle] = useState<string | null>(null);

  // The account's sample vehicle, if it has one. Failure is fine — the sheet
  // simply draws the empty slot, and its notes already say the photo is the
  // account's rather than the template's.
  useEffect(() => {
    if (!accountKey) {
      setSampleVehicle(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/ad-generator/sample-vehicle?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { vehicle: null }))
      .then((j: { vehicle?: { url: string } | null }) => {
        if (!cancelled) setSampleVehicle(j.vehicle?.url ?? null);
      })
      .catch(() => {
        if (!cancelled) setSampleVehicle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  /**
   * The branding the sheet draws with — the account's, exactly as the builder's
   * canvas and a real ad get it. Without this the sheet would prove a design with
   * no logo and no brand color, which is a design nobody ships.
   *
   * Held as its SERIALIZED form on purpose. `accountData` is a fresh object on
   * every render of the account context, so an object dependency here re-created
   * `load`, which re-ran the effect, which set state, which rendered again — the
   * sheet re-fetched forever and never left its loading state. A string compares
   * by value, so the fetch runs when the branding actually changes.
   */
  const dataJson = useMemo(
    () =>
      JSON.stringify({
        ...brandLogoData(accountData?.logos),
        ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
        ...(accountData?.branding?.colors?.primary
          ? { brandColor: accountData.branding.colors.primary }
          : {}),
        // The same stand-in the builder's canvas uses. A design hangs off the car's
        // silhouette, so an empty image slot says nothing about how the ad reads.
        ...(sampleVehicle ? { vehicleImageUrl: sampleVehicle } : {}),
      } satisfies AdData),
    [accountData, sampleVehicle],
  );

  const load = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${templateId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"accountKey":${JSON.stringify(accountKey ?? '')},"data":${dataJson}}`,
      });
      const json = (await res.json()) as Sheet & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not build the proof sheet');
      setSheet(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the proof sheet');
    } finally {
      setLoading(false);
    }
  }, [templateId, accountKey, dataJson]);

  useEffect(() => {
    void load();
  }, [load]);

  const scale = useMemo(() => sheetScale(sheet?.sizes ?? []), [sheet?.sizes]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            className={`flex items-center gap-2 font-semibold tracking-tight text-[var(--foreground)] ${layout === 'modal' ? 'text-lg' : 'text-2xl'}`}
          >
            {layout === 'modal' ? 'Proof sheet' : (sheet?.templateName ?? 'Proof sheet')}
            <HelpTip title="Proof sheet">
              <p className="mb-2">
                Every offer type this template serves, on every board it defines — drawn by the
                same renderer that exports the ad, and checked by the same compliance gate that
                generation runs.
              </p>
              <p>
                Boards share one scale, so a Facebook board really is three times the width of a
                Google rectangle. Nothing here is editable: it is the read before you publish.
              </p>
            </HelpTip>
          </h1>
          {sheet && (
            <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
              {sheet.rows.length} offer type{sheet.rows.length === 1 ? '' : 's'} ×{' '}
              {sheet.sizes.length} board{sheet.sizes.length === 1 ? '' : 's'} ·{' '}
              {sheet.rows.length * sheet.sizes.length} ads
              {sheet.make ? ` · ${sheet.make}` : ''}
              {' · '}
              {Math.round(scale * 100)}% scale
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Blocking and warnings are separate chips, in their own colors: one
              red badge reading "7 blocking · 17 warnings" made 17 things that
              block nothing look like part of the emergency. */}
          {sheet && sheet.ok && sheet.warningCount === 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400">
              <CheckCircleIcon className="h-4 w-4" />
              Every type clears
            </span>
          )}
          {sheet && sheet.errorCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400">
              <XCircleIcon className="h-4 w-4" />
              {sheet.errorCount} blocking
            </span>
          )}
          {sheet && sheet.warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-400">
              <ExclamationTriangleIcon className="h-4 w-4" />
              {sheet.warningCount} warning{sheet.warningCount === 1 ? '' : 's'}
            </span>
          )}
          {/* Clean of errors but carrying warnings: say the ads can ship, since
              that is the question the sheet exists to answer. */}
          {sheet && sheet.ok && sheet.warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400">
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Nothing blocked
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Re-check
          </button>
          {/* The page is still worth having — it is the version you can send to
              somebody. Offered, not imposed. */}
          {onOpenInTab && (
            <button
              type="button"
              onClick={onOpenInTab}
              title="Open the sheet as its own page, to link or print"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              Open as page
            </button>
          )}
        </div>
      </div>

      {/* What the reader needs in order not to over-trust a clean sheet. Sorted
          blocking → caution → context by `buildProofSheet`. */}
      {sheet && sheet.notes.length > 0 && (
        <ul className="mb-6 space-y-2">
          {sheet.notes.map((n) => (
            <Note key={`${n.tone}-${n.label}`} note={n} />
          ))}
        </ul>
      )}

      {/* Faults in the DESIGN — stated once, because every ad off this template
          reports them identically and the fix is in the design. Split by whether
          they stop an export, and collapsible: thirteen findings in one list made
          the reader do that sorting themselves. */}
      {sheet && sheet.templateFaults.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-[12px] text-[var(--muted-foreground)]">
            These are properties of the template, not of any one ad — fixing the design clears
            them for every ad it makes.
          </p>
          <FaultGroup
            title="blocking design fault"
            hint="No ad can ship until these are cleared"
            faults={sheet.templateFaults.filter((f) => f.severity === 'error')}
            sizes={sheet.sizes}
            tone="blocking"
            defaultOpen
          />
          <FaultGroup
            title="design warning"
            hint="Worth fixing; nothing is blocked"
            faults={sheet.templateFaults.filter((f) => f.severity !== 'error')}
            sizes={sheet.sizes}
            tone="warning"
            defaultOpen={false}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && !sheet && (
        <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">
          Rendering every board…
        </p>
      )}

      {sheet && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5">
          {sheet.rows.map((row) => (
            <Row key={row.offerType} row={row} scale={scale} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * THE SHEET, OVER THE EDITOR.
 *
 * Nearly the whole viewport, because the content is twenty ads at a shared scale
 * and a small dialog would defeat the one thing the sheet is for. Deliberately not
 * a route: the designer is mid-edit, and closing this puts them back on the board
 * they were working on with their selection and zoom intact.
 */
export function ProofSheetModal({
  templateId,
  templateName,
  onClose,
  onOpenInTab,
}: {
  templateId: string;
  templateName?: string;
  onClose: () => void;
  onOpenInTab?: () => void;
}) {
  // Escape closes it, like every other dialog in the builder. Nothing inside is
  // editable, so there is no unsaved work to guard.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center bg-black/70 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex min-h-0 w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Proof sheet"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--foreground)]">
              {templateName || 'Template'}
            </p>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              The saved design, drawn on every board and checked by the gate generation runs.
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        {/* The sheet scrolls inside the dialog: the grid is tall by design, and a
            dialog that grew with it would run off the screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ProofSheetView templateId={templateId} layout="modal" onOpenInTab={onOpenInTab} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
