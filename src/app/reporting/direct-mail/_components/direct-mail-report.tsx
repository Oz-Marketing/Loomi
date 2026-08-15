'use client';

/**
 * Direct Mail ROI body. Fetches /api/reporting/direct-mail.
 *
 * Two things this report says out loud that ODT's did not:
 *  - the return is NULL until someone has costed the mail, rather than showing
 *    revenue and calling it ROI;
 *  - a campaign whose 45-day service window is still open is still counting,
 *    so its numbers will rise.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  EnvelopeIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  BanknotesIcon,
  ScaleIcon,
  CursorArrowRaysIcon,
  TableCellsIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  usd0,
  pctText,
  prettyDate,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';

interface Campaign {
  id: string;
  campaignName: string;
  mailerType: string | null;
  mailedFrom: string;
  mailedTo: string;
  marketed: number;
  engaged: number;
  offerRequests: number | null;
  matchedCustomers: number;
  matchedRos: number;
  directMatches: number;
  indirectMatches: number;
  revenue: number;
  matchbackRate: number | null;
  engagementRate: number | null;
  revenuePerRo: number | null;
  revenuePerPiece: number | null;
}
interface Totals {
  campaigns: number;
  marketed: number;
  engaged: number;
  matchedCustomers: number;
  matchedRos: number;
  directMatches: number;
  indirectMatches: number;
  revenue: number;
  matchbackRate: number | null;
  engagementRate: number | null;
  revenuePerRo: number | null;
  revenuePerPiece: number | null;
}
interface Roi {
  cost: number | null;
  net: number | null;
  roiPct: number | null;
  costPerRo: number | null;
}
interface MailData {
  dealer: string;
  startDate: string;
  endDate: string;
  campaigns: Campaign[];
  totals: Totals;
  roi: Roi;
}

const pct = (v: number | null) => (v === null ? '—' : pctText(v));

/** A campaign is still accruing ROs for 45 days after its last in-home date. */
function stillCounting(c: Campaign): boolean {
  const closes = new Date(`${c.mailedTo}T00:00:00Z`);
  closes.setUTCDate(closes.getUTCDate() + 45);
  return closes > new Date();
}

export function DirectMailReport({
  accountKey,
  from,
  to,
}: {
  accountKey: string;
  from: string;
  to: string;
}) {
  const { data, error, isLoading } = useSWR<MailData, Error & { code?: string }>(
    `/api/reporting/direct-mail?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load direct mail"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const t = data.totals;
  if (!t.campaigns) {
    return (
      <EmptyState
        icon={EnvelopeIcon}
        title="No campaigns in this range"
        body="Nothing has been recorded for this account. Campaign matchbacks are computed on the Oz Reports host and pushed across — a sub-account with no mail in this window won't have any."
      />
    );
  }

  const open = data.campaigns.filter(stillCounting);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={EnvelopeIcon}
          label="Mailed"
          value={num(t.marketed)}
          secondary={`${num(t.campaigns)} campaign${t.campaigns === 1 ? '' : 's'}`}
          tone="primary"
        />
        <Kpi
          icon={CursorArrowRaysIcon}
          label="Engaged"
          value={num(t.engaged)}
          secondary={pct(t.engagementRate)}
          tone="sky"
        />
        <Kpi
          icon={UsersIcon}
          label="Came in"
          value={num(t.matchedCustomers)}
          secondary={`${pct(t.matchbackRate)} matchback`}
          tone="emerald"
        />
        <Kpi
          icon={WrenchScrewdriverIcon}
          label="Repair orders"
          value={num(t.matchedRos)}
          secondary={`${num(t.directMatches)} same vehicle`}
          tone="violet"
        />
        <Kpi
          icon={BanknotesIcon}
          label="Revenue"
          value={usd0(t.revenue)}
          secondary={t.revenuePerRo === null ? undefined : `${usd0(t.revenuePerRo)} per RO`}
          tone="amber"
        />
        <Kpi
          icon={ScaleIcon}
          label="Return"
          value={data.roi.roiPct === null ? '—' : `${data.roi.roiPct > 0 ? '+' : ''}${data.roi.roiPct.toFixed(0)}%`}
          secondary={
            data.roi.cost === null
              ? 'No mail spend on file'
              : `${usd0(data.roi.cost)} spent`
          }
          tone="zinc"
        />
      </div>

      {data.roi.roiPct === null && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <Muted>
              No return is shown because no direct-mail spend is recorded on the budget for this
              range. Revenue on its own is not a return — the old report showed one and called it
              ROI. Add the mail cost as a budget line and this fills in.
            </Muted>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <Muted>
              {open.length === 1
                ? `"${open[0].campaignName}" is still counting — `
                : `${open.length} campaigns are still counting — `}
              repair orders are attributed for 45 days after the last piece lands, so these figures
              will rise.
            </Muted>
          </div>
        </div>
      )}

      <Section
        title="Campaigns"
        subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}
        icon={TableCellsIcon}
      >
        <DataTable
          head={['Campaign', 'Mailed', 'Engaged', 'Came in', 'Matchback', 'ROs', 'Revenue', 'Per RO']}
          rows={data.campaigns.map((c) => [
            `${c.campaignName}${stillCounting(c) ? ' (open)' : ''}`,
            num(c.marketed),
            num(c.engaged),
            num(c.matchedCustomers),
            pct(c.matchbackRate),
            num(c.matchedRos),
            usd0(c.revenue),
            c.revenuePerRo === null ? '—' : usd0(c.revenuePerRo),
          ])}
          maxRows={12}
        />
      </Section>

      <Section title="How the matches break down" icon={WrenchScrewdriverIcon}>
        <DataTable
          head={['Match type', 'Repair orders', 'Share']}
          rows={[
            [
              'Same vehicle (direct)',
              num(t.directMatches),
              t.matchedRos > 0 ? pctText((t.directMatches / t.matchedRos) * 100) : '—',
            ],
            [
              'Different vehicle (indirect)',
              num(t.indirectMatches),
              t.matchedRos > 0 ? pctText((t.indirectMatches / t.matchedRos) * 100) : '—',
            ],
          ]}
          maxRows={4}
        />
        <div className="mt-3">
          <Muted>
            A direct match is a repair order on the exact vehicle the mailer was about. An indirect
            match is the same customer bringing in a different car — still business the mail
            brought in, but not the car it advertised.
          </Muted>
        </div>
      </Section>
    </div>
  );
}
