'use client';

/**
 * Call Tracking body. Fetches /api/reporting/call-tracking.
 *
 * Hour-of-day and day-of-week are rendered in the DEALERSHIP's timezone, not
 * the viewer's — "we miss calls at 8am" is a claim about their morning. The
 * section subtitles say which zone, because a chart that silently shifts by
 * six hours is worse than one that admits its frame.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  PhoneIcon,
  PhoneArrowDownLeftIcon,
  PhoneXMarkIcon,
  CheckCircleIcon,
  ClockIcon,
  MegaphoneIcon,
  MapPinIcon,
  ChartBarIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  pctText,
  prettyDate,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { MonthlyStackChart, RankedBarChart } from '../../_components/dealer-charts';

interface StatusCount {
  status: string;
  calls: number;
  share: number;
}
interface TrackerRow {
  name: string;
  calls: number;
  answered: number;
  missed: number;
  answerRate: number | null;
  avgDuration: number | null;
}
interface CityRow {
  city: string;
  calls: number;
  share: number;
}
interface CallData {
  dealer: string;
  startDate: string;
  endDate: string;
  timezone: string;
  summary: {
    calls: number;
    answered: number;
    missed: number;
    answerRate: number | null;
    avgDuration: number | null;
  };
  byStatus: StatusCount[];
  byTracker: TrackerRow[];
  byCity: CityRow[];
  byDayOfWeek: { day: string; calls: number }[];
  byHour: { hour: number; calls: number }[];
  byDate: { date: string; calls: number; answered: number }[];
}

/** Seconds → "5m 42s". Null stays an em dash — no answered calls, no duration. */
function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** 0 → "12am", 13 → "1pm". */
function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function CallTrackingReport({
  accountKey,
  from,
  to,
  timezone,
  isDark,
}: {
  accountKey: string;
  from: string;
  to: string;
  timezone: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<CallData, Error & { code?: string }>(
    `/api/reporting/call-tracking?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&tz=${encodeURIComponent(timezone)}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load call tracking"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const s = data.summary;
  if (!s.calls) {
    return (
      <EmptyState
        icon={PhoneIcon}
        title="No calls in this range"
        body="Nothing has been recorded for this account over the selected dates. Calls arrive from Oz Reports on the tracked-call sync — an account with no tracking numbers assigned won't have any."
      />
    );
  }

  const tzShort = data.timezone.split('/').pop()?.replace(/_/g, ' ') ?? data.timezone;

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={PhoneIcon} label="Calls" value={num(s.calls)} tone="primary" />
        <Kpi
          icon={PhoneArrowDownLeftIcon}
          label="Answered"
          value={num(s.answered)}
          tone="emerald"
        />
        <Kpi icon={PhoneXMarkIcon} label="Missed" value={num(s.missed)} tone="amber" />
        <Kpi
          icon={CheckCircleIcon}
          label="Answer rate"
          value={s.answerRate === null ? '—' : pctText(s.answerRate)}
          tone="sky"
        />
        <Kpi
          icon={ClockIcon}
          label="Avg call"
          value={duration(s.avgDuration)}
          secondary="Answered calls only"
          tone="violet"
        />
        <Kpi
          icon={MegaphoneIcon}
          label="Trackers"
          value={num(data.byTracker.length)}
          secondary="Campaigns with calls"
          tone="zinc"
        />
      </div>

      <Section
        title="Calls by day"
        subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}
        icon={ChartBarIcon}
      >
        <MonthlyStackChart
          categories={data.byDate.map((d) => prettyDate(d.date))}
          series={[
            { name: 'Calls', data: data.byDate.map((d) => d.calls) },
            { name: 'Answered', data: data.byDate.map((d) => d.answered) },
          ]}
          isDark={isDark}
          // Answered is a SUBSET of calls — stacking would double-count every
          // answered call in the day's total.
          stacked={false}
        />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="When people call" subtitle={`Hour of day, ${tzShort} time`} icon={ClockIcon}>
          <MonthlyStackChart
            categories={data.byHour.map((h) => hourLabel(h.hour))}
            series={[{ name: 'Calls', data: data.byHour.map((h) => h.calls) }]}
            isDark={isDark}
            showLegend={false}
          />
        </Section>

        <Section title="Which days" subtitle={`${tzShort} time`} icon={ChartBarIcon}>
          <MonthlyStackChart
            categories={data.byDayOfWeek.map((d) => d.day.slice(0, 3))}
            series={[{ name: 'Calls', data: data.byDayOfWeek.map((d) => d.calls) }]}
            isDark={isDark}
            showLegend={false}
          />
        </Section>
      </div>

      <Section title="Where callers are" subtitle="Top cities" icon={MapPinIcon}>
        {data.byCity.length ? (
          <RankedBarChart
            items={data.byCity.slice(0, 12).map((c) => ({ label: c.city, value: c.calls }))}
            isDark={isDark}
            valueLabel="Calls"
          />
        ) : (
          <Muted>No caller locations reported.</Muted>
        )}
      </Section>

      <Section title="By tracking campaign" icon={MegaphoneIcon}>
        <DataTable
          head={['Campaign', 'Calls', 'Answered', 'Missed', 'Answer rate', 'Avg call']}
          rows={data.byTracker.map((t) => [
            t.name,
            num(t.calls),
            num(t.answered),
            num(t.missed),
            t.answerRate === null ? '—' : pctText(t.answerRate),
            duration(t.avgDuration),
          ])}
          maxRows={12}
        />
        <div className="mt-3">
          <Muted>
            Average call length counts answered calls only. Averaging across missed calls too would
            drag every campaign toward zero in proportion to how many rang out — which reads as
            short conversations when it actually means nobody picked up.
          </Muted>
        </div>
      </Section>

      <Section title="Call outcomes" icon={TableCellsIcon}>
        <DataTable
          head={['Status', 'Calls', 'Share']}
          rows={data.byStatus.map((st) => [st.status, num(st.calls), pctText(st.share * 100)])}
          maxRows={8}
        />
      </Section>
    </div>
  );
}
