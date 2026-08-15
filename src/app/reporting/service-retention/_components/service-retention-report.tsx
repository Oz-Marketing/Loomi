'use client';

/**
 * Service Retention body. Fetches /api/reporting/service-retention and renders
 * the two cohort metrics.
 *
 * Every rate here depends on sale and service events being linked to the same
 * Contact. Unlinked events can't participate and bias rates down, so the
 * linkage-coverage banner is not decoration — don't remove it.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  ArrowPathIcon,
  UsersIcon,
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  WrenchScrewdriverIcon,
  LinkIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { CohortRateChart } from '../../_components/dealer-charts';

interface SalesCohort {
  cohortYear: number;
  totalSold: number;
  retained12m: number;
  retained24m: number;
  retainedEver: number;
  rate12m: number | null;
  rate24m: number | null;
  rateEver: number | null;
  monthsOld: number;
  mature12m: boolean;
  mature24m: boolean;
}
interface ServiceCohort {
  firstVisitYear: number;
  totalFirstTimers: number;
  returned12m: number;
  lost12m: number;
  rate12m: number | null;
}
interface Summary {
  salesTotal: number;
  salesTotal24m: number;
  salesTotalAll: number;
  salesRetained12m: number;
  salesRetained24m: number;
  salesRetainedEver: number;
  salesRate12m: number | null;
  salesRate24m: number | null;
  salesRateEver: number | null;
  svcTotal: number;
  svcRetained12m: number;
  svcRate12m: number | null;
}
interface Coverage {
  saleEvents: number;
  saleEventsLinked: number;
  serviceEvents: number;
  serviceEventsLinked: number;
  overall: number;
}
interface RetentionData {
  dealer: string;
  salesCohorts: SalesCohort[];
  serviceCohorts: ServiceCohort[];
  summary: Summary;
  coverage: Coverage;
}

/** An immature window prints as an em dash, matching the chart's gap. */
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

export function ServiceRetentionReport({
  accountKey,
  isDark,
}: {
  accountKey: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<RetentionData, Error & { code?: string }>(
    `/api/reporting/service-retention?accountKey=${encodeURIComponent(accountKey)}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load service retention"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const { summary: s, coverage: cov } = data;

  if (!data.salesCohorts.length && !data.serviceCohorts.length) {
    return (
      <EmptyState
        icon={ArrowPathIcon}
        title="Not enough history yet"
        body="Retention needs at least one closed cohort — a purchase or first service visit more than twelve months ago. Sales and service arrive on the nightly Oz Reports sync."
      />
    );
  }

  const salesYears = data.salesCohorts.map((c) => String(c.cohortYear));
  const svcYears = data.serviceCohorts.map((c) => String(c.firstVisitYear));

  const unlinked =
    cov.saleEvents + cov.serviceEvents - (cov.saleEventsLinked + cov.serviceEventsLinked);
  const coverageIsPoor = cov.overall < 0.9;

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={UsersIcon}
          label="Buyers measured"
          value={num(s.salesTotal)}
          secondary="Closed 12-mo cohorts"
          tone="primary"
        />
        <Kpi
          icon={ArrowUturnLeftIcon}
          label="Back in 12 mo"
          value={pct(s.salesRate12m)}
          secondary={`${num(s.salesRetained12m)} of ${num(s.salesTotal)}`}
          tone="emerald"
        />
        <Kpi
          icon={CalendarDaysIcon}
          label="Back in 24 mo"
          value={pct(s.salesRate24m)}
          secondary={`${num(s.salesRetained24m)} of ${num(s.salesTotal24m)}`}
          tone="sky"
        />
        <Kpi
          icon={CheckCircleIcon}
          label="Back ever"
          value={pct(s.salesRateEver)}
          secondary={`${num(s.salesRetainedEver)} of ${num(s.salesTotalAll)}`}
          tone="violet"
        />
        <Kpi
          icon={WrenchScrewdriverIcon}
          label="Service-only"
          value={num(s.svcTotal)}
          secondary="First-timers who never bought"
          tone="amber"
        />
        <Kpi
          icon={ArrowPathIcon}
          label="They came back"
          value={pct(s.svcRate12m)}
          secondary={`${num(s.svcRetained12m)} within 12 mo`}
          tone="zinc"
        />
      </div>

      {unlinked > 0 && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            coverageIsPoor
              ? 'border-amber-500/20 bg-amber-500/5'
              : 'border-[var(--border)] bg-[var(--muted)]/30'
          }`}
        >
          <div className="flex items-start gap-2">
            <LinkIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                coverageIsPoor ? 'text-amber-400' : 'text-[var(--muted-foreground)]'
              }`}
            />
            <Muted>
              {num(unlinked)} of {num(cov.saleEvents + cov.serviceEvents)} sale and service records (
              {((1 - cov.overall) * 100).toFixed(1)}%) aren&rsquo;t linked to a contact, usually
              because they arrived with no email or phone to match on. Retention can only be measured
              across linked records, so the real rates are at least this high and probably higher.
              Coverage improves on its own with each Sunday full-history sync.
            </Muted>
          </div>
        </div>
      )}

      <Section
        title="Buyers who came back for service"
        subtitle="By purchase year"
        icon={ArrowUturnLeftIcon}
      >
        {data.salesCohorts.length ? (
          <>
            <CohortRateChart
              categories={salesYears}
              series={[
                { name: 'Within 12 mo', data: data.salesCohorts.map((c) => c.rate12m) },
                { name: 'Within 24 mo', data: data.salesCohorts.map((c) => c.rate24m) },
                { name: 'Ever', data: data.salesCohorts.map((c) => c.rateEver) },
              ]}
              isDark={isDark}
            />
            <div className="mt-3">
              <Muted>
                A cohort shows no bar for a window that hasn&rsquo;t closed yet — this year&rsquo;s
                buyers can&rsquo;t have had twelve months to come back.
              </Muted>
            </div>
          </>
        ) : (
          <Muted>No purchase cohorts in the last five years.</Muted>
        )}
      </Section>

      {data.salesCohorts.length > 0 && (
        <Section title="Purchase cohorts" icon={TableCellsIcon}>
          <DataTable
            head={['Cohort', 'Sold', '12 mo', '24 mo', 'Ever', 'Rate 12 mo', 'Rate 24 mo', 'Rate ever']}
            rows={data.salesCohorts.map((c) => [
              String(c.cohortYear),
              num(c.totalSold),
              num(c.retained12m),
              num(c.retained24m),
              num(c.retainedEver),
              pct(c.rate12m),
              pct(c.rate24m),
              pct(c.rateEver),
            ])}
            maxRows={6}
          />
        </Section>
      )}

      <Section
        title="Service customers who came back"
        subtitle="First-time visitors who have never bought here, by first-visit year"
        icon={ArrowPathIcon}
      >
        {data.serviceCohorts.length ? (
          <CohortRateChart
            categories={svcYears}
            series={[{ name: 'Returned within 12 mo', data: data.serviceCohorts.map((c) => c.rate12m) }]}
            isDark={isDark}
          />
        ) : (
          <Muted>
            No service-only cohorts yet. Everyone who has serviced here in the last five years has
            also bought here, or their first visit was too recent to measure.
          </Muted>
        )}
      </Section>

      {data.serviceCohorts.length > 0 && (
        <Section title="First-visit cohorts" icon={TableCellsIcon}>
          <DataTable
            head={['First visit', 'First-timers', 'Returned', 'Lost', 'Return rate']}
            rows={data.serviceCohorts.map((c) => [
              String(c.firstVisitYear),
              num(c.totalFirstTimers),
              num(c.returned12m),
              num(c.lost12m),
              pct(c.rate12m),
            ])}
            maxRows={6}
          />
        </Section>
      )}
    </div>
  );
}
