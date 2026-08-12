'use client';

import { useCallback, useEffect, useState } from 'react';
import { BuildingStorefrontIcon, GlobeAltIcon } from '@heroicons/react/24/outline';

/**
 * Brand rail for the OEM shared library.
 *
 * The OEM tier was the whole point of the scope work and had no surface: an
 * admin could upload into it from the scope selector but could never sit down and
 * look at "Audi's shared library" as a set. This is that surface.
 *
 * Selecting a brand filters the existing admin grid rather than rendering a
 * second one, so selection, bulk actions, preview, rename and delete all keep
 * working with no duplicated behaviour.
 */

export interface BrandSummary {
  brand: string;
  assetCount: number;
  accountCount: number;
}

export function OemBrandRail({
  selected,
  onSelect,
  /** Bumped by the parent after an upload so counts refresh. */
  refreshKey = 0,
}: {
  selected: string | null;
  onSelect: (brand: string | null) => void;
  refreshKey?: number;
}) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [globalCount, setGlobalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/media/oem-summary');
      if (res.ok) {
        const data = await res.json();
        setBrands(data.brands || []);
        setGlobalCount(data.globalCount || 0);
      }
    } catch {
      /* an empty rail is better than a broken tab */
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const withAssets = brands.filter((b) => b.assetCount > 0);
  const empty = brands.filter((b) => b.assetCount === 0);

  if (loading && brands.length === 0) {
    return <p className="text-xs text-[var(--muted-foreground)]">Loading brands…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Global — not a brand, but it's the other half of the admin library and
          belongs in the same picker rather than being reachable only elsewhere. */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex w-full max-w-xs items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
          selected === null
            ? 'border-[var(--primary)] bg-[var(--primary)]/10'
            : 'border-[var(--border)] hover:bg-[var(--muted)]'
        }`}
      >
        <GlobeAltIcon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-[var(--foreground)]">
            Brand-agnostic
          </span>
          <span className="block text-[10px] text-[var(--muted-foreground)]">
            Every account · {globalCount} asset{globalCount === 1 ? '' : 's'}
          </span>
        </span>
      </button>

      {withAssets.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Shared libraries
          </p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {withAssets.map((b) => (
              <BrandButton key={b.brand} b={b} selected={selected === b.brand} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {empty.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            No shared assets yet
          </p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {empty.map((b) => (
              <BrandButton key={b.brand} b={b} selected={selected === b.brand} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {brands.length === 0 && (
        <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
          No sub-account has a brand set, so there are no OEM libraries to manage
          yet. Set a brand on an account in Settings.
        </p>
      )}
    </div>
  );
}

function BrandButton({
  b,
  selected,
  onSelect,
}: {
  b: BrandSummary;
  selected: boolean;
  onSelect: (brand: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(b.brand)}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-[var(--primary)] bg-[var(--primary)]/10'
          : 'border-[var(--border)] hover:bg-[var(--muted)]'
      }`}
    >
      <BuildingStorefrontIcon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--foreground)]">{b.brand}</span>
        <span className="block text-[10px] text-[var(--muted-foreground)]">
          {/* The reach number is the argument for the scope model: one asset here
              serves every one of these rooftops without a copy. */}
          {b.assetCount} asset{b.assetCount === 1 ? '' : 's'} · {b.accountCount} sub-account
          {b.accountCount === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}
