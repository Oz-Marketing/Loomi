'use client';

/**
 * Email Campaigns tab — GoHighLevel email performance. Fetches
 * /api/reporting/email and renders delivery KPIs, a status breakdown, and the
 * campaign list. GHL's email API reports delivery only (opens/clicks/bounces
 * aren't exposed by the API), so engagement shows a note when absent.
 */

import useSWR from 'swr';
import {
  EnvelopeIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EnvelopeOpenIcon,
  CursorArrowRaysIcon,
  LinkSlashIcon,
  InboxStackIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import {
  type DateRangeKey,
  fetcher,
  num,
  Kpi,
  Section,
  EmptyState,
  LoadingState,
  DataTable,
} from './shared';

interface Aggregate {
  total_campaigns: number;
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  delivery_rate: number;
  fail_rate: number;
  avg_open_rate: number;
  avg_click_rate: number;
  avg_recipients: number;
  has_engagement: boolean;
}
interface Campaign {
  id: string;
  name: string;
  status: string;
  scheduled_at: string;
  sent: number;
  delivered: number;
  delivery_rate: number;
  opened: number;
  clicked: number;
}
interface EmailData {
  dealer: string;
  stats: Aggregate;
  statusBreakdown: Record<string, number>;
  campaigns: Campaign[];
  totalCampaigns: number;
}

const rate = (v: number) => `${v}%`;
const shortDate = (iso: string) =>
  iso ? new Date(`${iso}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function EmailReport({
  accountKey,
  from,
  to,
  onJump,
}: {
  accountKey: string;
  from: string;
  to: string;
  compareTo: string;
  isDark: boolean;
  onJump: (k: DateRangeKey) => void;
}) {
  const { data, error, isLoading } = useSWR<EmailData, Error & { code?: string }>(
    `/api/reporting/email?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return error.code === 'not_configured' ? (
      <EmptyState icon={LinkSlashIcon} title="GoHighLevel not connected" body={error.message} />
    ) : (
      <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load email report" body={error.message} tone="error" />
    );
  }
  if (!data) return null;

  const s = data.stats;
  if (s.total_campaigns === 0) {
    return (
      <EmptyState
        icon={InboxStackIcon}
        title="No email campaigns in this window"
        body={`No GoHighLevel campaigns for ${data.dealer} in the selected range. Widen the range to see more.`}
        action={{ label: 'View last 12 months', onClick: () => onJump('12m') }}
      />
    );
  }

  const statuses = Object.entries(data.statusBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={EnvelopeIcon} label="Campaigns" value={num(s.total_campaigns)} tone="primary" />
        <Kpi icon={PaperAirplaneIcon} label="Sent" value={num(s.total_sent)} secondary={`${num(s.avg_recipients)} avg/campaign`} tone="sky" />
        <Kpi icon={CheckCircleIcon} label="Delivered" value={num(s.total_delivered)} secondary={`${rate(s.delivery_rate)} delivered`} tone="emerald" />
        <Kpi icon={ExclamationTriangleIcon} label="Failed" value={num(s.total_failed)} secondary={`${rate(s.fail_rate)} failed`} tone="amber" />
        <Kpi icon={EnvelopeOpenIcon} label="Open rate" value={rate(s.avg_open_rate)} tone="violet" />
        <Kpi icon={CursorArrowRaysIcon} label="Click rate" value={rate(s.avg_click_rate)} tone="zinc" />
      </div>

      {!s.has_engagement && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-3.5">
          <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs text-[var(--muted-foreground)]">
            GoHighLevel&apos;s email API reports <span className="font-medium text-[var(--foreground)]">delivery only</span> —
            opens, clicks and bounces aren&apos;t exposed by its API, so engagement rates read 0 here.
          </p>
        </div>
      )}

      {statuses.length > 0 && (
        <Section title="By status">
          <div className="flex flex-wrap gap-2">
            {statuses.map(([status, count]) => (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs"
              >
                <span className="capitalize text-[var(--foreground)]">{status}</span>
                <span className="font-semibold tabular-nums text-[var(--muted-foreground)]">{count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Campaigns" icon={EnvelopeIcon} subtitle={`${data.campaigns.length} in range`}>
        <DataTable
          head={['Campaign', 'Status', 'Scheduled', 'Sent', 'Delivered', 'Del. %', 'Opens', 'Clicks']}
          rows={data.campaigns.map((c) => [
            c.name,
            c.status,
            shortDate(c.scheduled_at),
            num(c.sent),
            num(c.delivered),
            rate(c.delivery_rate),
            num(c.opened),
            num(c.clicked),
          ])}
          maxRows={12}
        />
      </Section>
    </div>
  );
}
