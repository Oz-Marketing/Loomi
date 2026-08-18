'use client';

/**
 * Email & Text Blasts — every one-off send, whatever sent it.
 *
 * Replaces the old email-only report. Two things drive the layout:
 *
 * 1. **Channels are shown apart.** SMS has no open tracking, so a single
 *    engagement block over both would divide email opens by a denominator that
 *    grows with texting — see lib/reporting/blasts.ts. The header carries only
 *    sent / delivered / failed, which mean the same thing in both.
 *
 * 2. **The previous provider is never named.** Its sends appear as "Another
 *    provider" — the point is the history, not the vendor.
 */

import useSWR from 'swr';
import {
  PaperAirplaneIcon,
  EnvelopeOpenIcon,
  CursorArrowRaysIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  ChartBarIcon,
  TableCellsIcon,
  LinkIcon,
  NoSymbolIcon,
  InboxStackIcon,
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
} from './shared';
import { DailyStackChart, ShareDonut } from '../../_components/dealer-charts';
import { FlowsAnalyticsBody } from '@/components/flows/flows-analytics-body';
import type { ReportComponentProps } from './reports-config';

interface EmailTotals {
  campaigns: number;
  sent: number;
  delivered: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  bounces: number;
  failed: number;
  unsubscribes: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}
interface TextTotals {
  campaigns: number;
  sent: number;
  delivered: number;
  failed: number;
  optOuts: number;
  deliveryRate: number;
  failureRate: number;
  optOutRate: number;
}
interface BlastRow {
  id: string;
  name: string;
  channel: 'email' | 'text';
  source: 'loomi' | 'other';
  sentAt: string | null;
  sent: number;
  delivered: number;
  opens: number | null;
  clicks: number | null;
  failed: number;
  deliveryRate: number;
  openRate: number | null;
  clickRate: number | null;
}
interface BlastsData {
  dealer: string;
  combined: {
    campaigns: number;
    sent: number;
    delivered: number;
    failed: number;
    deliveryRate: number;
  };
  email: EmailTotals;
  text: TextTotals;
  sources: { source: string; label: string; campaigns: number; sent: number; share: number }[];
  blasts: BlastRow[];
  series: { date: string; delivered: number; opens: number; clicks: number }[];
  topUrls: { url: string; clicks: number }[];
  historyAvailable: boolean;
  historyNote: string | null;
  seriesIsLoomiOnly: boolean;
}

/** Rate as a percentage string, or an em dash where the measure doesn't exist. */
const rate = (v: number | null) => (v == null ? '—' : pctText(v * 100));

const SOURCE_TEXT: Record<string, string> = { loomi: 'Loomi', other: 'Another provider' };
const CHANNEL_TEXT: Record<string, string> = { email: 'Email', text: 'Text' };

/** The blasts half. Flows are appended by `BlastsReport` below, always. */
function BlastsBody({ accountKey, from, to, isDark }: ReportComponentProps) {
  const { data, error, isLoading } = useSWR<BlastsData, Error>(
    `/api/reporting/blasts?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load blasts"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const { combined, email, text, blasts } = data;

  if (!combined.campaigns) {
    return (
      <EmptyState
        icon={PaperAirplaneIcon}
        title="No sends in this window"
        body={
          data.historyAvailable
            ? 'Nothing went out for this account over the selected dates. Widen the range to see earlier sends.'
            : 'Nothing went out for this account over the selected dates, and no history from a previous provider is connected.'
        }
      />
    );
  }

  const hasEmail = email.campaigns > 0;
  const hasText = text.campaigns > 0;

  return (
    <div className="mt-8 space-y-8">
      {/* Header: only what means the same thing in both channels. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={PaperAirplaneIcon} label="Sends" value={num(combined.campaigns)} tone="primary" />
        <Kpi icon={InboxStackIcon} label="Messages sent" value={num(combined.sent)} tone="sky" />
        <Kpi icon={CheckCircleIcon} label="Delivered" value={num(combined.delivered)} tone="emerald" />
        <Kpi
          icon={CheckCircleIcon}
          label="Delivery rate"
          value={rate(combined.deliveryRate)}
          secondary="Email and text together"
          tone="emerald"
        />
        <Kpi
          icon={ExclamationTriangleIcon}
          label="Failed"
          value={num(combined.failed)}
          secondary={combined.sent ? rate(combined.failed / combined.sent) : undefined}
          tone="amber"
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
        <Muted>
          Opens and clicks are shown for email only. Text messaging has no open or click tracking —
          those measures don&rsquo;t exist for the channel, so they are left out of the combined
          figures above rather than counted as zero.
        </Muted>
      </div>

      {!data.historyAvailable && data.historyNote && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
          <Muted>{data.historyNote}</Muted>
        </div>
      )}

      {hasEmail && (
        <Section title="Email" subtitle={`${num(email.campaigns)} sends`} icon={EnvelopeIcon}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi icon={InboxStackIcon} label="Sent" value={num(email.sent)} tone="primary" />
            <Kpi
              icon={CheckCircleIcon}
              label="Delivered"
              value={rate(email.deliveryRate)}
              secondary={num(email.delivered)}
              tone="emerald"
            />
            <Kpi
              icon={EnvelopeOpenIcon}
              label="Open rate"
              value={rate(email.openRate)}
              secondary={`${num(email.uniqueOpens)} opens`}
              tone="sky"
            />
            <Kpi
              icon={CursorArrowRaysIcon}
              label="Click rate"
              value={rate(email.clickRate)}
              secondary={`${num(email.uniqueClicks)} clicks`}
              tone="violet"
            />
            <Kpi
              icon={ExclamationTriangleIcon}
              label="Bounce rate"
              value={rate(email.bounceRate)}
              secondary={`${num(email.bounces)} bounced`}
              tone="amber"
            />
            <Kpi
              icon={NoSymbolIcon}
              label="Unsubscribes"
              value={num(email.unsubscribes)}
              secondary={rate(email.unsubscribeRate)}
              tone="zinc"
            />
          </div>
        </Section>
      )}

      {hasText && (
        <Section title="Text" subtitle={`${num(text.campaigns)} sends`} icon={ChatBubbleLeftRightIcon}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={InboxStackIcon} label="Sent" value={num(text.sent)} tone="primary" />
            <Kpi
              icon={CheckCircleIcon}
              label="Delivered"
              value={rate(text.deliveryRate)}
              secondary={num(text.delivered)}
              tone="emerald"
            />
            <Kpi
              icon={ExclamationTriangleIcon}
              label="Failed"
              value={num(text.failed)}
              secondary={rate(text.failureRate)}
              tone="amber"
            />
            <Kpi
              icon={NoSymbolIcon}
              label="Opt-outs"
              value={num(text.optOuts)}
              secondary={rate(text.optOutRate)}
              tone="zinc"
            />
          </div>
          <div className="mt-3">
            <Muted>
              An opt-out is someone replying STOP. They are removed from every future text for this
              account automatically.
            </Muted>
          </div>
        </Section>
      )}

      {data.sources.length > 1 && (
        <Section title="Where sends came from" subtitle="By message volume" icon={ChartBarIcon}>
          <div className="grid gap-6 lg:grid-cols-2">
            <ShareDonut
              items={data.sources.map((s) => ({ label: s.label, value: s.sent }))}
              isDark={isDark}
            />
            <DataTable
              head={['Source', 'Sends', 'Messages', 'Share']}
              rows={data.sources.map((s) => [
                s.label,
                num(s.campaigns),
                num(s.sent),
                rate(s.share),
              ])}
            />
          </div>
          <div className="mt-3">
            <Muted>
              Sends made before this account moved to Loomi are grouped as &ldquo;another
              provider&rdquo;. They are kept so the history doesn&rsquo;t start over, but they
              arrive as per-send totals only — there is no day-by-day detail behind them.
            </Muted>
          </div>
        </Section>
      )}

      {data.series.length > 0 && (
        <Section
          title="Email engagement over time"
          subtitle={data.seriesIsLoomiOnly ? 'Loomi sends only' : undefined}
          icon={ChartBarIcon}
        >
          <DailyStackChart
            rows={data.series}
            series={[
              { name: 'Delivered', key: 'delivered' },
              { name: 'Opens', key: 'opens' },
              { name: 'Clicks', key: 'clicks' },
            ]}
            isDark={isDark}
          />
          {data.seriesIsLoomiOnly && (
            <div className="mt-3">
              <Muted>
                This chart covers Loomi sends only. The earlier provider hands over per-send totals
                without the underlying events, so its activity can&rsquo;t honestly be placed on a
                calendar — spreading each send across its window would draw a shape that never
                happened. Its volume is included everywhere else on this page.
              </Muted>
            </div>
          )}
        </Section>
      )}

      <Section title="All sends" subtitle="Newest first" icon={TableCellsIcon}>
        <DataTable
          head={['Send', 'Channel', 'Source', 'Date', 'Sent', 'Delivered', 'Opens', 'Clicks']}
          rows={blasts.map((b) => [
            b.name,
            CHANNEL_TEXT[b.channel] ?? b.channel,
            SOURCE_TEXT[b.source] ?? b.source,
            b.sentAt ?? 'No date',
            num(b.sent),
            rate(b.deliveryRate),
            // Em dash on a text row: the measure doesn't exist, and a 0%
            // would read as "nobody opened it".
            b.openRate == null ? '—' : rate(b.openRate),
            b.clickRate == null ? '—' : rate(b.clickRate),
          ])}
          maxRows={25}
        />
        <div className="mt-3">
          <Muted>
            A dash under Opens or Clicks means the channel has no such measure, not that the figure
            was zero. Sends with no date are historical records that arrived without one.
          </Muted>
        </div>
      </Section>

      {data.topUrls.length > 0 && (
        <Section title="Most-clicked links" subtitle="Loomi email sends" icon={LinkIcon}>
          <DataTable
            head={['Link', 'Clicks']}
            rows={data.topUrls.map((u) => [u.url, num(u.clicks)])}
            maxRows={10}
          />
        </Section>
      )}
    </div>
  );
}

/**
 * Blasts + Flows on one page.
 *
 * Flows renders unconditionally — including when there were no blasts in the
 * window. An account can easily have live drip series and no one-off sends this
 * month, and an empty-state for blasts must not take the automations down with
 * it.
 */
export function BlastsReport(props: ReportComponentProps) {
  return (
    <>
      <BlastsBody {...props} />

      <div className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Flows
        </h2>
        <FlowsAnalyticsBody
          // `scopeKey` remounts the body when the scope changes; the window is
          // part of the scope, or switching dates would leave the previous
          // period's numbers on screen while the new ones load.
          scopeKey={`${props.accountKey || 'all'}:${props.from}:${props.to}`}
          subtitle="Automated drip series — separate from the one-off sends above"
          showAccountColumn={false}
          presetAccountKey={props.accountKey || null}
          showPageHeader={false}
          from={props.from}
          to={props.to}
        />
      </div>
    </>
  );
}
