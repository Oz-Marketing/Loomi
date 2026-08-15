'use client';

import { useCallback, useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * The Scope section of the admin filter rail.
 *
 * Replaces three separate tabs (Sub-account Media, Loomi Media, OEM Libraries)
 * that were all asking one question: which slice of the library am I looking at?
 * Tabs implied three different screens with three different sets of controls; in
 * practice they shared a grid, a search box and every facet, and the only
 * difference was a where-clause. So it belongs in the rail beside the other
 * filters, not above them as navigation.
 *
 * Scope is single-select and lives on top of the facets rather than beside them:
 * the facets narrow WITHIN a scope, so their counts only mean anything once the
 * scope is settled.
 */

export type AdminScope =
  | { kind: 'all' }
  | { kind: 'global' }
  | { kind: 'oem'; value: string }
  | { kind: 'account'; value: string };

export function scopeKey(scope: AdminScope): string {
  return scope.kind === 'oem' || scope.kind === 'account'
    ? `${scope.kind}:${scope.value}`
    : scope.kind;
}

/** Query params for a scope — the one place the API contract is expressed. */
export function scopeToParams(scope: AdminScope): Record<string, string> {
  switch (scope.kind) {
    case 'all':
      return { accountKey: 'all' };
    // Admin-level with no brand. `oem=none` is required: omitting it would
    // include every OEM-shared asset too.
    case 'global':
      return { oem: 'none' };
    case 'oem':
      return { oem: scope.value };
    case 'account':
      return { accountKey: scope.value };
  }
}

/**
 * Placeholder-friendly form. Brand and dealer names are proper nouns and stay
 * cased; the generic scopes read better lowercased mid-sentence.
 */
export function scopeSearchLabel(scope: AdminScope, dealerName?: string): string {
  switch (scope.kind) {
    case 'all':
      return 'all assets';
    case 'global':
      return 'brand-agnostic assets';
    default:
      return scopeLabel(scope, dealerName);
  }
}

export function scopeLabel(scope: AdminScope, dealerName?: string): string {
  switch (scope.kind) {
    case 'all':
      return 'All assets';
    case 'global':
      return 'Brand-agnostic';
    case 'oem':
      return scope.value;
    case 'account':
      return dealerName || scope.value;
  }
}

interface BrandSummary {
  brand: string;
  assetCount: number;
  accountCount: number;
}

function Row({
  active,
  onClick,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className={`block truncate text-[10px] font-normal ${active ? 'text-[var(--primary)]/70' : 'text-[var(--muted-foreground)]'}`}>
            {hint}
          </span>
        )}
      </span>
      {typeof count === 'number' && (
        <span className={`mt-0.5 shrink-0 text-[10px] tabular-nums ${active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function MediaScopeSection({
  scope,
  onScopeChange,
  /** Connected sub-accounts, with their dealer name and asset count when known. */
  accounts,
  /** Bumped after an upload so brand counts refresh. */
  refreshKey = 0,
}: {
  scope: AdminScope;
  onScopeChange: (next: AdminScope) => void;
  accounts: { key: string; dealer: string; count?: number }[];
  refreshKey?: number;
}) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [globalCount, setGlobalCount] = useState(0);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/media/oem-summary');
      if (res.ok) {
        const data = await res.json();
        setBrands(data.brands || []);
        setGlobalCount(data.globalCount || 0);
      }
    } catch {
      /* an empty scope list still leaves "All assets" working */
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const current = scopeKey(scope);

  // Only brands that hold something, plus whichever is selected. A rail listing
  // twenty empty marques buries the libraries that exist — the OEM tab showed
  // empty ones deliberately, but that was a management screen and this is a
  // filter.
  const brandRows = brands.filter((b) => b.assetCount > 0 || current === `oem:${b.brand}`);

  // Sub-accounts are by far the longest group, and on a real tenant most hold
  // nothing. Same rule as brands: what exists leads, and empties collapse —
  // otherwise the one account with assets sits below seven that don't.
  const sortedAccounts = [...accounts].sort(
    (a, b) => (b.count ?? 0) - (a.count ?? 0) || a.dealer.localeCompare(b.dealer),
  );
  const withCount = sortedAccounts.filter(
    (a) => (a.count ?? 0) > 0 || current === `account:${a.key}`,
  );
  // Still capped: an agency with sixty active rooftops shouldn't get sixty rows.
  const accountRows = showAllAccounts ? sortedAccounts : withCount.slice(0, 10);
  const hiddenAccounts = sortedAccounts.length - accountRows.length;

  return (
    // Fills the rail wrapper, which owns the width.
    <div className="w-full min-w-0 space-y-3">
      {/* No "Scope" heading: this list leads the rail, directly under the search
          box, so the only thing it could be is the scope. The row renders ONLY
          when Reset is available — an always-present empty flex row would still
          contribute a space-y-3 gap above the list. */}
      {scope.kind !== 'all' && (
        <div className="flex items-center justify-end px-2">
          <button
            type="button"
            onClick={() => onScopeChange({ kind: 'all' })}
            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-3 w-3" />
            Reset
          </button>
        </div>
      )}

      <div className="space-y-0.5">
        <Row
          active={current === 'all'}
          onClick={() => onScopeChange({ kind: 'all' })}
          label="All assets"
          hint="Every scope"
        />
        <Row
          active={current === 'global'}
          onClick={() => onScopeChange({ kind: 'global' })}
          label="Brand-agnostic"
          hint="Shared with every account"
          count={globalCount}
        />
      </div>

      {brandRows.length > 0 && (
        <Group title="OEM libraries">
          {brandRows.map((b) => (
            <Row
              key={b.brand}
              active={current === `oem:${b.brand}`}
              onClick={() => onScopeChange({ kind: 'oem', value: b.brand })}
              label={b.brand}
              // The reach number is the argument for the whole scope model: one
              // asset here serves this many rooftops without a copy.
              hint={`${b.accountCount} sub-account${b.accountCount === 1 ? '' : 's'}`}
              count={b.assetCount}
            />
          ))}
        </Group>
      )}

      {(accountRows.length > 0 || hiddenAccounts > 0) && (
        <Group title="Sub-accounts">
          {accountRows.map((a) => (
            <Row
              key={a.key}
              active={current === `account:${a.key}`}
              onClick={() => onScopeChange({ kind: 'account', value: a.key })}
              label={a.dealer}
              count={a.count}
            />
          ))}
          {hiddenAccounts > 0 && !showAllAccounts && (
            <button
              type="button"
              onClick={() => setShowAllAccounts(true)}
              className="w-full px-2 py-1 text-left text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Show {hiddenAccounts} more
            </button>
          )}
          {showAllAccounts && sortedAccounts.length > withCount.length && (
            <button
              type="button"
              onClick={() => setShowAllAccounts(false)}
              className="w-full px-2 py-1 text-left text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Show fewer
            </button>
          )}
        </Group>
      )}
    </div>
  );
}
