'use client';

/**
 * Customer Heatmap body. Fetches /api/reporting/customer-geography and renders
 * the geographic breakdown of sales or service volume.
 *
 * NO BASE MAP YET — see the page component for why. Everything here is the
 * geography itself (ranked ZIPs, cities, shares), which is the part that does
 * not depend on how we eventually draw the map. When a map layer lands it
 * consumes `data.zips` unchanged.
 *
 * The placement banner is load-bearing: an event only appears here if it is
 * linked to a Contact AND that Contact has a postal code. Dropping a third of
 * the ROs silently would make every share on this page wrong.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  MapIcon,
  MapPinIcon,
  TruckIcon,
  WrenchScrewdriverIcon,
  BanknotesIcon,
  BuildingOffice2Icon,
  TagIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  usd0,
  pctText,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { RankedBarChart } from '../../_components/dealer-charts';
import { ZipBubbleMap } from '../../_components/zip-bubble-map';

export type GeographyMode = 'sales' | 'service';
export type DealTypeFilter = 'ALL' | 'NEW' | 'USED' | 'LEASE';

interface ZipRow {
  postalCode: string;
  city: string | null;
  state: string | null;
  count: number;
  revenue: number;
  customerPay: number;
  warrantyPay: number;
  share: number;
  lat: number | null;
  lng: number | null;
}
interface Mapping {
  unmappedZips: number;
  unmappedCount: number;
}
interface Totals {
  count: number;
  revenue: number;
  customerPay: number;
  warrantyPay: number;
  avgValue: number;
  zipCount: number;
}
interface Placement {
  events: number;
  placed: number;
  unlinked: number;
  noPostal: number;
  overall: number;
}
interface GeographyData {
  dealer: string;
  mode: GeographyMode;
  dealType: DealTypeFilter;
  startDate: string;
  endDate: string;
  zips: ZipRow[];
  totals: Totals;
  placement: Placement;
  mapping: Mapping;
}

const TOP_N = 12;

/** "Layton, UT" — falls back to the bare ZIP when the contact had no city. */
function placeLabel(z: ZipRow): string {
  if (!z.city) return z.postalCode;
  return z.state ? `${z.city}, ${z.state}` : z.city;
}

export function CustomerGeographyReport({
  accountKey,
  mode,
  dealType,
  from,
  to,
  isDark,
}: {
  accountKey: string;
  mode: GeographyMode;
  dealType: DealTypeFilter;
  from: string;
  to: string;
  isDark: boolean;
}) {
  const query = new URLSearchParams({
    accountKey,
    mode,
    deal_type: dealType,
    start_date: from,
    end_date: to,
  });
  const { data, error, isLoading } = useSWR<GeographyData, Error & { code?: string }>(
    `/api/reporting/customer-geography?${query.toString()}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load customer geography"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const { totals: t, placement: p } = data;
  const isSales = data.mode === 'sales';

  if (!t.count) {
    return (
      <EmptyState
        icon={MapIcon}
        title={isSales ? 'No deals to map' : 'No repair orders to map'}
        body={
          p.events > 0
            ? `There ${p.events === 1 ? 'is' : 'are'} ${num(p.events)} ${
                isSales ? 'deal' : 'repair order'
              }${p.events === 1 ? '' : 's'} in this range, but none could be placed — they have no contact match or no postal code on file.`
            : 'Nothing has been recorded for this account over the selected dates.'
        }
      />
    );
  }

  const top = data.zips.slice(0, TOP_N);

  // Cities aggregate several ZIPs, so this is a genuinely different cut rather
  // than a relabelled version of the ZIP chart.
  const byCity = new Map<string, number>();
  for (const z of data.zips) {
    const key = z.city ? (z.state ? `${z.city}, ${z.state}` : z.city) : 'Unknown city';
    byCity.set(key, (byCity.get(key) ?? 0) + z.count);
  }
  const topCities = [...byCity.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, TOP_N);

  const unplaced = p.events - p.placed;
  const placementIsPoor = p.overall < 0.9;
  const topZip = data.zips[0];

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={isSales ? TruckIcon : WrenchScrewdriverIcon}
          label={isSales ? 'Units' : 'Repair orders'}
          value={num(t.count)}
          tone="primary"
        />
        <Kpi
          icon={BanknotesIcon}
          label="Revenue"
          value={usd0(t.revenue)}
          secondary={isSales ? 'Customer price, not gross' : undefined}
          tone="violet"
        />
        <Kpi
          icon={TagIcon}
          label={isSales ? 'Avg per unit' : 'Avg per RO'}
          value={usd0(t.avgValue)}
          tone="zinc"
        />
        <Kpi icon={MapPinIcon} label="ZIP codes" value={num(t.zipCount)} tone="sky" />
        <Kpi
          icon={BuildingOffice2Icon}
          label="Top ZIP"
          value={topZip.postalCode}
          secondary={`${placeLabel(topZip)} — ${pctText(topZip.share * 100)}`}
          tone="emerald"
        />
        <Kpi
          icon={MapIcon}
          label="Placed"
          value={pctText(p.overall * 100)}
          secondary={`${num(p.placed)} of ${num(p.events)}`}
          tone="amber"
        />
      </div>

      {unplaced > 0 && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            placementIsPoor
              ? 'border-amber-500/20 bg-amber-500/5'
              : 'border-[var(--border)] bg-[var(--muted)]/30'
          }`}
        >
          <div className="flex items-start gap-2">
            <MapPinIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                placementIsPoor ? 'text-amber-400' : 'text-[var(--muted-foreground)]'
              }`}
            />
            <Muted>
              {num(unplaced)} of {num(p.events)} {isSales ? 'deals' : 'repair orders'} (
              {((1 - p.overall) * 100).toFixed(1)}%) couldn&rsquo;t be placed
              {p.unlinked > 0 && ` — ${num(p.unlinked)} aren't matched to a contact`}
              {p.unlinked > 0 && p.noPostal > 0 && ', and'}
              {p.noPostal > 0 && ` ${num(p.noPostal)} belong to a contact with no postal code`}. Every
              share on this page is out of the {num(p.placed)} that could be placed, not out of{' '}
              {num(p.events)}.
            </Muted>
          </div>
        </div>
      )}

      <Section
        title="Where customers are"
        subtitle={`${num(t.count)} ${isSales ? 'units' : 'repair orders'} across ${num(t.zipCount)} ZIP codes`}
        icon={MapIcon}
      >
        <ZipBubbleMap
          points={data.zips}
          isDark={isDark}
          unit={isSales ? 'units' : 'repair orders'}
        />
        {data.mapping.unmappedZips > 0 && (
          <div className="mt-3">
            <Muted>
              {num(data.mapping.unmappedZips)} ZIP
              {data.mapping.unmappedZips === 1 ? '' : 's'} ({num(data.mapping.unmappedCount)}{' '}
              {isSales ? 'units' : 'ROs'}) aren&rsquo;t drawn — no US Census record for them, which
              usually means a non-US postal code, a PO-box-only ZIP, or a typo at the source.
              They&rsquo;re still counted in every figure and listed in the table below.
            </Muted>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title={`Top ZIP codes`}
          subtitle={`by ${isSales ? 'units' : 'repair orders'}`}
          icon={MapPinIcon}
        >
          <RankedBarChart
            items={top.map((z) => ({ label: z.postalCode, value: z.count }))}
            isDark={isDark}
            valueLabel={isSales ? 'Units' : 'ROs'}
          />
        </Section>

        <Section title="Top cities" subtitle={`by ${isSales ? 'units' : 'repair orders'}`} icon={BuildingOffice2Icon}>
          <RankedBarChart
            items={topCities}
            isDark={isDark}
            valueLabel={isSales ? 'Units' : 'ROs'}
          />
        </Section>
      </div>

      <Section
        title="Every ZIP code"
        subtitle={`${num(t.zipCount)} in range`}
        icon={TableCellsIcon}
      >
        <DataTable
          head={
            isSales
              ? ['ZIP', 'City', 'Units', 'Share', 'Revenue']
              : ['ZIP', 'City', 'ROs', 'Share', 'Revenue', 'Customer pay', 'Warranty']
          }
          rows={data.zips.map((z) => [
            z.postalCode,
            placeLabel(z),
            num(z.count),
            pctText(z.share * 100),
            usd0(z.revenue),
            ...(isSales ? [] : [usd0(z.customerPay), usd0(z.warrantyPay)]),
          ])}
          maxRows={15}
        />
      </Section>
    </div>
  );
}
