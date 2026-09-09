'use client';

/**
 * Choosing between the designs built for one offer.
 *
 * The offer fan-out renders every published template against the same offer, so
 * the dealer's job stops being "approve this ad" and becomes "pick the one you
 * want". This is that surface: the designs side by side at the same scale, the
 * generator's recommendation marked, and one action per design.
 *
 * Deliberately NOT a carousel or a diff view. These are alternatives, not
 * versions — they want to be compared at a glance, which means all of them on
 * screen at one size.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { AdPreviewThumb } from './ad-preview-thumb';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData, AdTemplate } from '@/lib/ad-generator/types';

export interface CompareVariant {
  id: string;
  name: string;
  templateId: string;
  status: string;
  doc?: TemplateDoc | null;
  data: AdData;
  recommended?: boolean;
  selectedAt?: string | null;
  reviewNotes?: string | null;
}

function notesOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function VariantCompareModal({
  open,
  offerName,
  variants,
  templates,
  branding,
  busyId,
  onPick,
  onPickAll,
  otherOfferCount = 0,
  onUndo,
  onOpenEditor,
  onClose,
}: {
  open: boolean;
  offerName: string;
  variants: CompareVariant[];
  templates: AdTemplate[];
  branding: Parameters<typeof AdPreviewThumb>[0]['branding'];
  /** Id currently being picked — the button that was pressed shows the wait. */
  busyId: string | null;
  onPick: (id: string) => void;
  /**
   * Apply one design to EVERY offer in the run, not just this one.
   *
   * A dealer usually wants one look for the month — the per-offer choice exists
   * for the exception, not the rule, and making them repeat the same pick six
   * times is the shape of that mistake. Omitted when there is nothing else to
   * apply it to.
   */
  onPickAll?: (templateId: string) => void;
  /** Offers besides this one, so the button can say what it will touch. */
  otherOfferCount?: number;
  onUndo: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const chosen = variants.find((v) => v.selectedAt) ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-modal-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-6xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Designs for ${offerName}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-[var(--foreground)]">{offerName}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {chosen
                ? `Using "${templates.find((t) => t.id === chosen.templateId)?.name ?? chosen.templateId}". The others are archived.`
                : `${variants.length} templates were built for this offer. Choose one for this offer, or apply it to every offer in the run.`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* `auto-rows-min` + `content-start` are load-bearing: the grid is a flex
            child with a definite height, and each card sets `overflow-hidden`
            (for the rounded thumbnail), which drops its min-content
            contribution to zero. Without these the rows compress and the
            design name and its button get clipped away. */}
        <div className="grid flex-1 auto-rows-min content-start grid-cols-1 gap-5 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-3">
          {variants.map((v) => {
            // Two different templates here, deliberately:
            //
            //  • `template` renders the thumbnail, and must come from the ad's OWN
            //    doc snapshot so the preview matches what would actually export.
            //  • `label` names the design, and must come from the SOURCE template,
            //    because the whole job of this screen is telling variants apart.
            //    The doc snapshot carries the ad's name — identical across every
            //    sibling, since they all advertise the same offer — so labeling
            //    from it renders three cards all reading "Untitled ad".
            const template = v.doc ? adTemplateFromDoc(v.id, v.doc) : templates.find((t) => t.id === v.templateId);
            const label = templates.find((t) => t.id === v.templateId)?.name ?? template?.name ?? v.templateId;
            const isChosen = !!v.selectedAt;
            const notes = notesOf(v.reviewNotes);
            const busy = busyId === v.id;
            return (
              <div
                key={v.id}
                className={`flex flex-col overflow-hidden rounded-xl border transition-colors ${
                  isChosen ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-[var(--border)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpenEditor(v.id)}
                  className="block w-full text-left transition-opacity hover:opacity-90"
                  aria-label={`Open ${label} in the editor`}
                >
                  <AdPreviewThumb template={template} data={v.data} branding={branding} />
                </button>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isChosen && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        <CheckCircleIcon className="h-2.5 w-2.5" />
                        In use
                      </span>
                    )}
                    {v.recommended && !isChosen && (
                      <span
                        title="The design the generator ranked first for this offer"
                        className="inline-flex items-center gap-1 rounded bg-[var(--primary)]/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--primary)]"
                      >
                        <SparklesIcon className="h-2.5 w-2.5" />
                        Recommended
                      </span>
                    )}
                    {v.status !== 'ready' && (
                      <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        {v.status}
                      </span>
                    )}
                  </div>

                  <div className="truncate text-xs font-semibold text-[var(--foreground)]" title={label}>
                    {label}
                  </div>

                  {/* Why the generator held it back, or what broke at pick time.
                      Shown here rather than hidden behind the card, because it is
                      the difference between two designs that look identical. */}
                  {notes.length > 0 && (
                    <ul className="space-y-1">
                      {notes.slice(0, 2).map((n, i) => (
                        <li key={i} className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                          {n}
                        </li>
                      ))}
                      {notes.length > 2 && (
                        <li className="text-[10px] text-[var(--muted-foreground)]">
                          +{notes.length - 2} more note{notes.length - 2 === 1 ? '' : 's'}
                        </li>
                      )}
                    </ul>
                  )}

                  <div className="mt-auto pt-1">
                    {isChosen ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUndo(v.id)}
                        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:opacity-50"
                      >
                        {busy ? 'Undoing…' : 'Undo this choice'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || !!chosen}
                        title={chosen ? 'Undo the current choice first' : undefined}
                        onClick={() => onPick(v.id)}
                        className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? 'Setting up…' : 'Use for this offer'}
                      </button>
                    )}
                    {/* The common case, one click. Deliberately secondary
                        styling: it touches every offer in the run, so it should
                        not be the thing a thumb lands on by accident. */}
                    {!isChosen && onPickAll && otherOfferCount > 0 && (
                      <button
                        type="button"
                        disabled={busy || !!chosen}
                        title={chosen ? 'Undo the current choice first' : undefined}
                        onClick={() => onPickAll(v.templateId)}
                        className="mt-1.5 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Use for all {otherOfferCount + 1} offers
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted-foreground)]">
          Picking a design renders its remaining sizes and archives the others. Nothing is deleted — archived
          designs can be restored from the Archived filter.
        </div>
      </div>
    </div>,
    document.body,
  );
}
