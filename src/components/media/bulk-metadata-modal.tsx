'use client';

import { useMemo, useState } from 'react';
import {
  AssetMetadataFields,
  EMPTY_ASSET_METADATA,
  assetMetadataDiff,
  type AssetMetadataValue,
} from '@/components/media/asset-metadata-fields';

/**
 * Apply metadata to many assets at once.
 *
 * Replaces the spreadsheet round-trip that enterprise DAMs offer for this. A
 * spreadsheet earns its keep when values differ per row, and OEM licence terms
 * don't — they're uniform per programme — so this is the same job with no file
 * format, parser or partial-import failure to maintain.
 *
 * Starts blank rather than pre-filled from the selection. Showing one asset's
 * values would imply they apply to all of them, and the first thing anyone did
 * would be to overwrite forty assets with the wrong brand.
 */
export function BulkMetadataModal({
  count,
  accountBrands,
  onCancel,
  onApply,
  busy = false,
}: {
  count: number;
  accountBrands: string[];
  onCancel: () => void;
  onApply: (body: Record<string, unknown>) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState<AssetMetadataValue>(EMPTY_ASSET_METADATA);

  /**
   * Diffing against EMPTY is what produces "only the fields I filled" — the
   * same helper the single-asset editor uses for its sparse PATCH, so the two
   * can't disagree about what a touched field is.
   */
  const body = useMemo(() => assetMetadataDiff(value, EMPTY_ASSET_METADATA), [value]);
  const fieldCount = Object.keys(body).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
      onClick={busy ? undefined : onCancel}
    >
      {/* Scrolling lives on the BODY, not on this box.
          globals.css forces `overflow: visible` on `.glass-modal:has(.glass-dropdown)`
          so a Select's panel isn't clipped — and this form is full of Selects, so
          an `overflow-y-auto` here is silently cancelled and the footer becomes
          unreachable on a short viewport. Flex column with a scrollable middle
          keeps Apply pinned and always clickable. */}
      <div className="glass-modal flex max-h-[85vh] w-[520px] flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-base font-semibold">
            Edit {count} asset{count === 1 ? '' : 's'}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            Fields you fill in are applied to all {count}. Anything left blank keeps
            its current value.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-40">
          <AssetMetadataFields
            value={value}
            onChange={setValue}
            accountBrands={accountBrands}
            disabled={busy}
          />
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-4">
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {fieldCount === 0
              ? 'Nothing filled in yet'
              : `${fieldCount} field${fieldCount === 1 ? '' : 's'} will be applied`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(body)}
              disabled={busy || fieldCount === 0}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Applying…' : `Apply to ${count}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
