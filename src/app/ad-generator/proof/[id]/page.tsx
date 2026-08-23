'use client';

/**
 * THE PROOF SHEET — every offer type this template serves × every board it
 * defines, drawn by the real renderer and checked by the real compliance gate.
 *
 * WHY A PAGE AND NOT A PANEL. This is the pre-publish read: twenty ads at once,
 * scrollable, printable, linkable. The builder's preview tabs answer one cell of
 * the grid at a time from memory, which is how templates shipped with a lease
 * board nobody had looked at. Opening the whole grid is the check.
 *
 * The design comes from the SAVED template row, so what is drawn here is what
 * automation would use. The builder autosaves, so the two are never far apart —
 * but a sheet that quietly proved an unsaved draft would be worse than useless.
 *
 * Everything shown is computed server-side by
 * POST /api/ad-generator/templates-doc/[id]/proof, which shares `buildProofSheet`
 * with nothing else and `preflight` with the generation pipeline. See
 * docs/ad-generator-archetypes.md §8 Phase 4.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { HelpTip } from '@/components/ui/help-tip';
import { brandLogoData } from '@/lib/ad-generator/brand-logos';
import { offerTypePill, offerTypeShort } from '@/lib/ad-generator/offer-type-style';
import type { ProofBoard, ProofRow, ProofSheet } from '@/lib/ad-generator/proof-sheet';
import type { PreflightIssue } from '@/lib/ad-generator/preflight';
import type { AdData } from '@/lib/ad-generator/types';

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

export default function ProofSheetPage() {
  const params = useParams<{ id: string }>();
  const templateId = params?.id ?? '';
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
   * no logo and no brand colour, which is a design nobody ships.
   */
  /**
   * The branding the sheet draws with — the account's, exactly as the builder's
   * canvas and a real ad get it. Without this the sheet would prove a design with
   * no logo and no brand colour, which is a design nobody ships.
   *
   * Held as its SERIALISED form on purpose. `accountData` is a fresh object on
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
    <div className="mx-auto max-w-[1500px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/ad-generator/builder?template=${encodeURIComponent(templateId)}${accountKey ? `&account=${encodeURIComponent(accountKey)}` : ''}`}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Back to the builder
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            {sheet?.templateName ?? 'Proof sheet'}
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
          {sheet && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                sheet.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/40 bg-red-500/10 text-red-400'
              }`}
            >
              {sheet.ok ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <XCircleIcon className="h-4 w-4" />
              )}
              {sheet.ok ? 'Every type clears' : `${sheet.errorCount} blocking`}
              {sheet.warningCount > 0 && ` · ${sheet.warningCount} warning${sheet.warningCount === 1 ? '' : 's'}`}
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
        </div>
      </div>

      {/* What the reader needs in order not to over-trust a clean sheet. */}
      {sheet && sheet.notes.length > 0 && (
        <ul className="mb-6 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          {sheet.notes.map((n) => (
            <li key={n} className="text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
              {n}
            </li>
          ))}
        </ul>
      )}

      {/* Faults in the DESIGN — stated once, because every ad off this template
          reports them identically and the fix is in the design. */}
      {sheet && sheet.templateFaults.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
            <ExclamationTriangleIcon className="h-4 w-4 text-amber-400" />
            The design fails {sheet.templateFaults.length} manufacturer rule
            {sheet.templateFaults.length === 1 ? '' : 's'}
          </h2>
          <p className="mb-3 text-[12px] text-[var(--muted-foreground)]">
            These are properties of the template, not of any one ad — fixing the design clears
            them for every ad it makes.
          </p>
          <ul className="space-y-2">
            {sheet.templateFaults.map((f) => (
              <li key={`${f.ruleId}-${f.description}`} className="text-[12px] leading-snug">
                <span className={f.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                  {f.description}
                </span>
                {f.offerTypes.length > 0 && (
                  <span className="ml-1.5 inline-flex flex-wrap gap-1">
                    {f.offerTypes.map((t) => (
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
                {f.citation && (
                  <span className="ml-1 text-[var(--muted-foreground)]">({f.citation})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
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
    </div>
  );
}
