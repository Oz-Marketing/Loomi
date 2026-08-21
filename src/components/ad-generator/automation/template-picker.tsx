'use client';

import { useMemo } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import { AdPreviewThumb } from '@/components/ad-generator/ad-preview-thumb';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { usableByAutomation } from '@/lib/ad-generator/offer-kinds';
import { SYSTEM_FIELD_DEFAULTS } from '@/lib/ad-generator/system-fields';
import type { AdData } from '@/lib/ad-generator/types';

/**
 * Picking the design the automation builds every ad from.
 *
 * This is the ONE decision a dealer makes about automated ads. Everything else —
 * which vehicles, which offers, how many, when — is either derived from the feed
 * or set once by the agency. So it earns a real picker rather than a dropdown of
 * names: the thing being chosen is a picture, and a list of words is a poor way
 * to choose a picture.
 *
 * Only templates marked usable by automation are offered. A design built for a
 * person to fill has fields the feed cannot supply, and offering it here would
 * produce ads with holes in them.
 */

export interface PickerTemplate {
  id: string;
  name: string;
  doc: TemplateDoc | null;
  /** False = shared into this account rather than owned by it. */
  owned?: boolean;
}

/** Preview values that read as a real ad without looking like a real offer. */
const PREVIEW_DATA: AdData = { ...SYSTEM_FIELD_DEFAULTS, offerType: 'lease' };

export function AutomationTemplatePicker({
  templates,
  value,
  onChange,
  branding,
  disabled = false,
  showUnusable = false,
}: {
  templates: PickerTemplate[];
  value: string;
  onChange: (id: string) => void;
  /** Account branding, so each preview shows the dealer's own logo and color. */
  branding: AdData;
  disabled?: boolean;
  /**
   * Also show custom-only designs, greyed out and labelled.
   *
   * Off for dealers, who can't act on the information and would just see choices
   * that don't work. On for admins, where "why isn't my template in this list"
   * is a real question and the answer — it's marked custom-only — is one they
   * can go and change.
   */
  showUnusable?: boolean;
}) {
  const usable = useMemo(
    () => templates.filter((t) => t.doc && usableByAutomation(t.doc)),
    [templates],
  );
  const unusable = useMemo(
    () => (showUnusable ? templates.filter((t) => t.doc && !usableByAutomation(t.doc)) : []),
    [templates, showUnusable],
  );

  // Distinguishing "no templates at all" from "none marked for automation" is
  // the difference between a designer building one and a designer flipping a
  // switch on one that already exists.
  if (!usable.length && !unusable.length) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-xs text-[var(--foreground)]">
            {templates.length ? (
              <>
                <span className="font-semibold">No design is available for automated ads yet.</span>{' '}
                {templates.length} design{templates.length === 1 ? ' is' : 's are'} in your library, but
                none is marked for automatic ads. Ask your Oz contact to enable one.
              </>
            ) : (
              <>
                <span className="font-semibold">No designs in your library yet.</span> Your Oz contact
                sets these up.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div
      role="radiogroup"
      aria-label="Design for automated ads"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {usable.map((t) => {
        const selected = t.id === value;
        const template = t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined;
        const sizes = t.doc?.sizes ?? [];
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(selected ? '' : t.id)}
            className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:pointer-events-none disabled:opacity-60 ${
              selected
                ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]'
                : 'border-[var(--border)] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-lg'
            }`}
          >
            {selected && (
              <CheckCircleIcon className="absolute right-2 top-2 z-10 h-5 w-5 text-[var(--primary)] drop-shadow" />
            )}
            <AdPreviewThumb template={template} data={PREVIEW_DATA} branding={branding} height={150} />
            <div className="border-t border-[var(--border)] bg-[var(--card)] p-2.5">
              <div className="truncate text-xs font-semibold text-[var(--foreground)]">{t.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                <span>
                  {sizes.length} size{sizes.length === 1 ? '' : 's'}
                </span>
                {t.owned === false && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>shared</span>
                  </>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>

    {/* Admin only. Not selectable — the point is to explain an absence, so these
        say what's wrong and where to fix it rather than offering a dead choice. */}
    {unusable.length > 0 && (
      <div className="mt-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Not available for automatic ads ({unusable.length})
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {unusable.map((t) => (
            <div
              key={t.id}
              className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] opacity-55"
              title="Marked custom-only in the builder"
            >
              <AdPreviewThumb
                template={t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined}
                data={PREVIEW_DATA}
                branding={branding}
                height={150}
              />
              <div className="border-t border-[var(--border)] bg-[var(--card)] p-2.5">
                <div className="truncate text-xs font-semibold text-[var(--foreground)]">{t.name}</div>
                <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                  Custom ads only — change its usage in the builder to allow automatic ads.
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    </>
  );
}
