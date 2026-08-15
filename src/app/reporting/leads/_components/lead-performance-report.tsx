'use client';

/**
 * Lead Performance body. Fetches /api/reporting/leads.
 *
 * The disclosure banner is load-bearing, not decoration: Loomi's lead count is
 * structurally lower than Oz Dealer Tools', because the bridge drops the CRM's
 * BAD and DUPLICATE leads before they ever arrive. Anyone comparing the two
 * reports will see the gap; the banner is what stops them reading it as data
 * loss. See lib/reporting/lead-performance.ts.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  UserPlusIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  FunnelIcon,
  TagIcon,
  TableCellsIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  pctText,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { MonthlyStackChart, RankedBarChart } from '../../_components/dealer-charts';

interface LeadMonth {
  period: string;
  label: string;
  leads: number;
  converted: number;
  conversionRate: number | null;
}
interface Breakdown {
  label: string;
  leads: number;
  share: number;
}
interface Comparison {
  currentPeriod: string;
  priorPeriod: string;
  currentLeads: number;
  priorLeads: number;
  changePct: number | null;
  partial: boolean;
  throughDay: number | null;
  priorThroughDay: number | null;
}
interface LeadData {
  dealer: string;
  period: string;
  label: string;
  partial: boolean;
  throughDay: number | null;
  current: LeadMonth | null;
  months: LeadMonth[];
  momCompare: Comparison;
  yoyCompare: Comparison;
  ytd: number;
  ytdPrior: number;
  ytdChangePct: number | null;
  bySource: Breakdown[];
  byCategory: Breakdown[];
}

/** A signed percentage, or an em dash when there was no prior base. */
const delta = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

function comparisonNote(c: Comparison): string {
  const base = `${num(c.currentLeads)} vs ${num(c.priorLeads)}`;
  if (!c.partial || c.throughDay == null) return base;
  // Say when the prior cut landed somewhere else — a March-vs-February
  // comparison at day 31 is really "all of February", and silently comparing
  // 31 days against 28 is the bug this wording exists to prevent.
  const clamped = c.priorThroughDay != null && c.priorThroughDay !== c.throughDay;
  return clamped
    ? `${base} — through day ${c.throughDay}, prior month through day ${c.priorThroughDay} (its last)`
    : `${base} — both through day ${c.throughDay}`;
}

export function LeadPerformanceReport({
  accountKey,
  period,
  isDark,
}: {
  accountKey: string;
  period: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<LeadData, Error & { code?: string }>(
    `/api/reporting/leads?accountKey=${encodeURIComponent(accountKey)}&period=${period}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load lead performance"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const hasAny = data.months.some((m) => m.leads > 0);
  if (!hasAny) {
    return (
      <EmptyState
        icon={UserPlusIcon}
        title="No leads on file"
        body="Nothing has been recorded for this account. Leads arrive from Oz Reports on the hourly sync — and only leads the CRM hasn't already marked BAD or DUPLICATE are sent."
      />
    );
  }

  const current = data.current;
  const categories = data.months.map((m) => m.label);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={UserPlusIcon}
          label="Leads"
          value={num(current?.leads ?? 0)}
          secondary={data.partial ? `Through day ${data.throughDay}` : data.label}
          tone="primary"
        />
        <Kpi
          icon={ArrowTrendingUpIcon}
          label="vs last month"
          value={delta(data.momCompare.changePct)}
          secondary={comparisonNote(data.momCompare)}
          tone="emerald"
        />
        <Kpi
          icon={CalendarDaysIcon}
          label="vs last year"
          value={delta(data.yoyCompare.changePct)}
          secondary={comparisonNote(data.yoyCompare)}
          tone="sky"
        />
        <Kpi
          icon={ChartBarIcon}
          label="Year to date"
          value={num(data.ytd)}
          secondary={`${delta(data.ytdChangePct)} vs ${num(data.ytdPrior)}`}
          tone="violet"
        />
        <Kpi
          icon={FunnelIcon}
          label="Bought"
          value={num(current?.converted ?? 0)}
          secondary="Leads with a later sale"
          tone="amber"
        />
        <Kpi
          icon={TagIcon}
          label="Conversion"
          value={current?.conversionRate === null || current == null ? '—' : pctText(current.conversionRate)}
          secondary="At least this high"
          tone="zinc"
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
        <div className="flex items-start gap-2">
          <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <Muted>
            These are leads the CRM hadn&rsquo;t already marked bad or duplicate — those are
            filtered out before they reach Loomi, so this count is lower than the raw lead total
            the CRM shows, and lower than the old Oz Dealer Tools report. Conversion counts leads
            matched to a later sale, so it is a floor: a sale that couldn&rsquo;t be matched back
            to its lead isn&rsquo;t counted.
          </Muted>
        </div>
      </div>

      <Section
        title="Leads by month"
        subtitle={`${data.months.length} months through ${data.label}`}
        icon={ChartBarIcon}
      >
        <MonthlyStackChart
          categories={categories}
          series={[
            { name: 'Leads', data: data.months.map((m) => m.leads) },
            { name: 'Bought', data: data.months.map((m) => m.converted) },
          ]}
          isDark={isDark}
          // Bought is a SUBSET of leads, not a separate bucket — stacking would
          // add the same person in twice.
          stacked={false}
        />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Lead sources" subtitle={data.label} icon={FunnelIcon}>
          {data.bySource.length ? (
            <RankedBarChart
              items={data.bySource.slice(0, 10).map((s) => ({ label: s.label, value: s.leads }))}
              isDark={isDark}
              valueLabel="Leads"
            />
          ) : (
            <Muted>No leads in this month.</Muted>
          )}
        </Section>

        <Section title="Lead categories" subtitle={data.label} icon={TagIcon}>
          {data.byCategory.length ? (
            <RankedBarChart
              items={data.byCategory.slice(0, 10).map((c) => ({ label: c.label, value: c.leads }))}
              isDark={isDark}
              valueLabel="Leads"
            />
          ) : (
            <Muted>No categorised leads in this month.</Muted>
          )}
        </Section>
      </div>

      <Section title="Monthly detail" icon={TableCellsIcon}>
        <DataTable
          head={['Month', 'Leads', 'Bought', 'Conversion']}
          rows={data.months
            .slice()
            .reverse()
            .map((m) => [
              m.label,
              num(m.leads),
              num(m.converted),
              m.conversionRate === null ? '—' : pctText(m.conversionRate),
            ])}
          maxRows={12}
        />
      </Section>
    </div>
  );
}
