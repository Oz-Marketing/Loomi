'use client';

/**
 * Customer Heatmap — where an account's buyers and service customers live.
 *
 * Port of Oz Dealer Tools' HeatmapReport.
 *
 * ── WHY THE MAP IS HAND-DRAWN ───────────────────────────────────────────────
 * ODT drew a Google Maps HeatmapLayer and geocoded every ZIP client-side on
 * each page load, with the API key hardcoded in the view. Loomi instead bundles
 * a US Census ZIP centroid table on the SERVER, joins it at query time, and
 * renders bubbles as inline SVG (`_components/zip-bubble-map.tsx`), so the
 * browser only ever receives the few dozen ZIPs that have data.
 *
 * The deciding factor was the PDF exporter: it drives headless Chromium on the
 * droplet, where a tile-based map would need outbound network access, a
 * server-IP-restricted key, and a race against async tile loads on every
 * capture. Inline SVG is in the DOM synchronously. No key, no per-load billing,
 * and dealer customer distributions never leave our infrastructure. Full
 * reasoning in docs/odt-reporting-migration.md.
 *
 * The trade-off is no street context behind the bubbles. City labels on the
 * largest ZIPs and a scale bar do the orienting instead.
 */

import { useState } from 'react';
import { MapIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { PageHeader } from '@/components/page-header';
import {
  EmptyState,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import {
  CustomerGeographyReport,
  type GeographyMode,
  type DealTypeFilter,
} from './_components/customer-geography-report';

/** Matches the segmented control in ad-filter-panel.tsx. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-lg border border-[var(--border)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-[var(--primary)] text-white'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ReportingHeatmapPage() {
  const { accountKey, accountData, isGroup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [mode, setMode] = useState<GeographyMode>('sales');
  const [dealType, setDealType] = useState<DealTypeFilter>('ALL');
  const { from, to } = resolveBounds(rangeKey, customRange);

  const scopeLabel = accountKey && !isGroup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={MapIcon}
        title="Customer heatmap"
        subtitle={`Where buyers and service customers live, by ZIP code — ${scopeLabel}.`}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'sales' as GeographyMode, label: 'Sales' },
              { value: 'service' as GeographyMode, label: 'Service' },
            ]}
          />
          {/* Deal type is meaningless for a repair order, so it only appears
              on the sales side rather than sitting there disabled. */}
          {mode === 'sales' && (
            <Segmented
              value={dealType}
              onChange={setDealType}
              options={[
                { value: 'ALL' as DealTypeFilter, label: 'All' },
                { value: 'NEW' as DealTypeFilter, label: 'New' },
                { value: 'USED' as DealTypeFilter, label: 'Used' },
                { value: 'LEASE' as DealTypeFilter, label: 'Lease' },
              ]}
            />
          )}
        </div>

        <DashboardToolbar
          dateRange={rangeKey}
          onDateRangeChange={setRangeKey}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          showReset={false}
          align="left"
          hidePresets={['all']}
          minDate={ALL_TIME_FLOOR}
        />
      </div>

      {isGroup || !accountKey ? (
        <EmptyState
          icon={MapIcon}
          title="Pick an account"
          body="Choose a single sub-account from the top bar to see where its customers come from."
        />
      ) : (
        <CustomerGeographyReport
          accountKey={accountKey}
          mode={mode}
          dealType={dealType}
          from={from}
          to={to}
          isDark={isDark}
        />
      )}
    </>
  );
}
