/**
 * Ad Meeting deliverable — assembles every live report for one account into a
 * single `ReportDoc` that the existing PDF/XLSX exporters render.
 *
 * Port of Oz Dealer Tools' AdMeetingReport, which was a staff-only page that
 * fanned out to every other report and topped it with an AI-written analysis.
 *
 * ── WHY THIS IS A DOCUMENT, NOT A PAGE ──────────────────────────────────────
 * ODT's version rendered its own dashboard. Loomi already has that: each report
 * is its own page, and `ReportDoc` + the PDF exporter already exist. The thing
 * that was genuinely missing is the *deliverable* — one artifact covering every
 * channel, prepared before a client meeting. So this assembles rather than
 * re-renders, and every number in it comes from the same route the on-screen
 * report uses. If a figure here disagrees with a report page, that is a bug in
 * this file, not a difference of opinion.
 *
 * ── PARTIAL ASSEMBLY IS THE NORMAL CASE ─────────────────────────────────────
 * No account has every channel. A source that is unconfigured, unconnected, or
 * failing is recorded in `unavailable` and listed in the document's own
 * "Not included" section — never dropped. A meeting deck that silently omits
 * the channel nobody set up is how a rep gets blindsided in the room.
 *
 * ── NO MARGIN, EVEN THOUGH THIS IS STAFF-BUILT ──────────────────────────────
 * Assembly is gated to staff because it is a lot of vendor calls, but the
 * artifact is shown TO the client. It therefore carries the same client-safe
 * figures as the rest of Reporting — see lib/reporting/budget-view.ts. Staff
 * authorship is not permission to include cost or markup.
 */
import type { ReportDoc, ReportSection, ReportKpi, CellType } from './report-doc';

export type SourceStatus = 'ok' | 'unavailable';

/** One platform's contribution, already reduced to flat metrics by the caller. */
export interface PlatformResult {
  key: string;
  label: string;
  status: SourceStatus;
  /** Why it's missing — shown verbatim in "Not included". */
  note?: string;
  metrics: Record<string, number> | null;
  /**
   * Paid media. Set by the caller from the source registry, not inferred here.
   *
   * This was a denylist of two keys, which meant every source added to the
   * fan-out silently joined the "Media performance" table — a channel that
   * buys nothing would appear in a client deck as a row of zeros beside real
   * spend, which reads as a campaign that ran and failed.
   */
  media: boolean;
}

export interface SalesSummary {
  totalUnits: number;
  newUnits: number;
  usedUnits: number;
  leaseUnits: number;
  totalRevenue: number;
  avgPrice: number;
}
export interface ServiceSummary {
  roCount: number;
  totalRevenue: number;
  avgRoValue: number;
}
export interface BudgetSummary {
  contractTotal: number | null;
  planned: number;
  spent: number | null;
  byChannel: { label: string; amount: number }[];
}

export interface LeadsSummary {
  leads: number;
  converted: number;
}

export interface MeetingInput {
  dealer: string;
  startDate: string;
  endDate: string;
  platforms: PlatformResult[];
  sales?: SalesSummary | null;
  service?: ServiceSummary | null;
  budget?: BudgetSummary | null;
  leads?: LeadsSummary | null;
  /** Claude's written analysis, already generated. Optional. */
  analysis?: string | null;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v: number) => Math.round(v * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Media columns every ad platform reports, in a fixed order. */
const MEDIA_COLUMNS: { header: string; type: CellType; total?: 'sum' | 'avg' | 'none' }[] = [
  { header: 'Channel', type: 'text' },
  { header: 'Spend', type: 'currency' },
  { header: 'Impressions', type: 'integer' },
  { header: 'Clicks', type: 'integer' },
  { header: 'CTR', type: 'percent', total: 'none' },
  { header: 'Conversions', type: 'integer' },
];

/**
 * Media metrics use different field names per platform — Google reports `cost`
 * where Meta and StackAdapt report `spend`. The roll-up configs encode the same
 * mapping for the on-screen roll-up; this is the server-side twin.
 */
function mediaRow(p: PlatformResult): (string | number)[] | null {
  const m = p.metrics;
  if (!m) return null;
  const spend = n(m.spend ?? m.cost);
  const impressions = n(m.impressions);
  const clicks = n(m.clicks);
  const conversions = n(m.conversions);
  // Recomputed from the summed parts rather than averaging a reported CTR —
  // a mean of rates is not the rate of the totals.
  const ctr = round2(div(clicks, impressions) * 100);
  return [p.label, round2(spend), impressions, clicks, ctr, conversions];
}

/** True when a platform reported nothing at all — spend, traffic, everything zero. */
export function isSilent(p: PlatformResult): boolean {
  const m = p.metrics;
  if (!m) return true;
  return (
    n(m.spend ?? m.cost) === 0 &&
    n(m.impressions) === 0 &&
    n(m.clicks) === 0 &&
    n(m.conversions) === 0 &&
    n(m.sessions) === 0
  );
}

/**
 * Split the analysis into one row per paragraph.
 *
 * `ReportDoc` has no prose field — it is a KPI + table format, and both
 * exporters render only those. Rather than widen the shared type (and the PDF
 * template with it) for one report, the analysis rides as a single-column
 * section: it reads as stacked paragraphs in the PDF and as one column in the
 * workbook, which is what a reader wants from it anyway.
 */
export function analysisSection(analysis: string): ReportSection | null {
  const paragraphs = analysis
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;
  return {
    title: 'Analysis',
    columns: [{ header: 'Summary', type: 'text' }],
    rows: paragraphs.map((p) => [p]),
  };
}

export function buildMeetingDoc(input: MeetingInput): ReportDoc {
  const live = input.platforms.filter((p) => p.status === 'ok' && p.metrics);
  const unavailable = input.platforms.filter((p) => p.status !== 'ok' || !p.metrics);

  // Non-media sources report traffic, ratings, calls and profile activity, not
  // media buys — each gets its own section rather than a row of empty spend
  // columns. The flag is declared per source; see PlatformResult.media.
  const mediaPlatforms = live.filter((p) => p.media);
  const ga4 = live.find((p) => p.key === 'ga4');
  const reputation = live.find((p) => p.key === 'reputation');
  const calls = live.find((p) => p.key === 'call-tracking');
  const gbp = live.find((p) => p.key === 'gbp');

  const mediaRows = mediaPlatforms
    .map(mediaRow)
    .filter((r): r is (string | number)[] => r !== null);

  const totalSpend = round2(
    mediaPlatforms.reduce((s, p) => s + n(p.metrics?.spend ?? p.metrics?.cost), 0),
  );
  const totalImpressions = mediaPlatforms.reduce((s, p) => s + n(p.metrics?.impressions), 0);
  const totalClicks = mediaPlatforms.reduce((s, p) => s + n(p.metrics?.clicks), 0);
  const totalConversions = mediaPlatforms.reduce((s, p) => s + n(p.metrics?.conversions), 0);

  const kpis: ReportKpi[] = [
    { label: 'Media spend', value: usd(totalSpend) },
    { label: 'Impressions', value: int(totalImpressions) },
    { label: 'Clicks', value: int(totalClicks), secondary: `${pct(div(totalClicks, totalImpressions) * 100)} CTR` },
    { label: 'Conversions', value: int(totalConversions) },
  ];
  if (input.sales) {
    kpis.push({
      label: 'Units sold',
      value: int(input.sales.totalUnits),
      secondary: `${usd(input.sales.avgPrice)} avg`,
    });
  }
  if (input.service) {
    kpis.push({
      label: 'Repair orders',
      value: int(input.service.roCount),
      secondary: `${usd(input.service.avgRoValue)} avg`,
    });
  }

  const sections: ReportSection[] = [];

  // sections[0] is the report's PRIMARY table by convention — media is the
  // reason this meeting exists.
  sections.push({
    title: 'Media performance',
    columns: MEDIA_COLUMNS,
    rows: mediaRows.length
      ? mediaRows
      : [['No media channels reported for this range', '', '', '', '', '']],
  });

  if (ga4?.metrics) {
    const m = ga4.metrics;
    sections.push({
      title: 'Website',
      columns: [
        { header: 'Metric', type: 'text' },
        { header: 'Value', type: 'integer' },
      ],
      rows: [
        ['Sessions', n(m.sessions)],
        ['Users', n(m.totalUsers)],
        ['New users', n(m.newUsers)],
        ['Page views', n(m.pageViews)],
      ],
    });
  }

  if (reputation?.metrics) {
    const m = reputation.metrics;
    sections.push({
      title: 'Reputation',
      columns: [
        { header: 'Metric', type: 'text' },
        { header: 'Value', type: 'text' },
      ],
      rows: [
        ['Average rating', m.rating ? m.rating.toFixed(1) : '—'],
        ['Total reviews', int(n(m.reviewCount))],
      ],
    });
  }

  if (calls?.metrics) {
    const m = calls.metrics;
    sections.push({
      title: 'Call tracking',
      columns: [
        { header: 'Measure', type: 'text' },
        { header: 'Value', type: 'text' },
      ],
      rows: [
        ['Tracked calls', int(n(m.calls))],
        ['Answered / missed', `${int(n(m.answered))} / ${int(n(m.missed))}`],
        // answerRate and avgDuration are already scaled and rounded by
        // lib/reporting/call-tracking.ts — don't re-scale.
        ['Answer rate', m.answerRate != null ? pct(n(m.answerRate)) : '—'],
        [
          'Average talk time',
          m.avgDuration != null ? `${Math.round(n(m.avgDuration))}s` : '—',
        ],
      ],
    });
  }

  if (gbp?.metrics) {
    const m = gbp.metrics;
    sections.push({
      title: 'Business Profile',
      columns: [
        { header: 'Measure', type: 'text' },
        { header: 'Value', type: 'integer' },
      ],
      rows: [
        ['Profile views', n(m.totalImpressions)],
        ['Website clicks', n(m.websiteClicks)],
        ['Calls', n(m.callClicks)],
        ['Direction requests', n(m.directionRequests)],
      ],
    });
  }

  if (input.leads) {
    const l = input.leads;
    sections.push({
      title: 'Leads',
      columns: [
        { header: 'Measure', type: 'text' },
        { header: 'Value', type: 'text' },
      ],
      rows: [
        // Labelled to survive a side-by-side with Oz Dealer Tools, which
        // counted bad and duplicate leads this number never sees — the CRM
        // filters them before the bridge sends anything.
        ['Leads (excluding bad & duplicate)', int(l.leads)],
        ['Bought', int(l.converted)],
        ['Conversion', l.leads > 0 ? pct(div(l.converted, l.leads) * 100) : '—'],
      ],
    });
  }

  if (input.sales) {
    const s = input.sales;
    sections.push({
      title: 'Sales',
      columns: [
        { header: 'Measure', type: 'text' },
        { header: 'Value', type: 'text' },
      ],
      rows: [
        ['Units', int(s.totalUnits)],
        ['New / Used / Lease', `${int(s.newUnits)} / ${int(s.usedUnits)} / ${int(s.leaseUnits)}`],
        // Named explicitly — this is transaction price, not dealer gross, and
        // the label is the only thing preventing that misreading in a meeting.
        ['Customer revenue', usd(s.totalRevenue)],
        ['Average per unit', usd(s.avgPrice)],
      ],
    });
  }

  if (input.service) {
    const s = input.service;
    sections.push({
      title: 'Service',
      columns: [
        { header: 'Measure', type: 'text' },
        { header: 'Value', type: 'text' },
      ],
      rows: [
        ['Repair orders', int(s.roCount)],
        ['Revenue', usd(s.totalRevenue)],
        ['Average per RO', usd(s.avgRoValue)],
      ],
    });
  }

  if (input.budget) {
    const b = input.budget;
    sections.push({
      title: 'Budget',
      columns: [
        { header: 'Channel', type: 'text' },
        { header: 'Planned', type: 'currency' },
      ],
      rows: b.byChannel.length
        ? b.byChannel.map((c) => [c.label, round2(c.amount)])
        : [['No budget assigned to a channel', 0]],
    });
  }

  if (input.analysis) {
    const section = analysisSection(input.analysis);
    if (section) sections.push(section);
  }

  // Always last, and always present when something is missing.
  if (unavailable.length) {
    sections.push({
      title: 'Not included',
      columns: [
        { header: 'Source', type: 'text' },
        { header: 'Reason', type: 'text' },
      ],
      rows: unavailable.map((p) => [p.label, p.note || 'No data available']),
    });
  }

  const meta: { label: string; value: string }[] = [
    { label: 'Account', value: input.dealer },
    { label: 'Period', value: `${input.startDate} – ${input.endDate}` },
    { label: 'Channels included', value: String(live.length) },
  ];
  if (input.budget?.contractTotal != null) {
    meta.push({ label: 'Contract', value: usd(input.budget.contractTotal) });
  }

  return {
    title: `Marketing review — ${input.dealer}`,
    subtitle: `${input.startDate} – ${input.endDate}`,
    meta,
    kpis,
    sections,
  };
}

// ── Display helpers (the doc carries formatted strings in text cells) ──

function usd(v: number): string {
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
function int(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
function pct(v: number): string {
  return `${v.toFixed(2)}%`;
}
