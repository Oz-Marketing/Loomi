'use client';

/**
 * Compare (delivery/reallocation spec §10) — the deliberate "who gives, who
 * gets" face-off.
 *
 * WHY THIS EXISTS ALONGSIDE THE MULTI-OPEN EXPANDERS. Expanded rows already
 * handle the everyday case, but only for campaigns that happen to sit near each
 * other: two rows eight lines apart are a memory game, and the decision this
 * screen supports — which campaign gives budget and which receives it — is
 * exactly the one where the two campaigns are furthest apart in the list.
 *
 * LAYOUT IS THE FEATURE. Campaigns are COLUMNS and metrics are ROWS, so the eye
 * runs across one metric at a time and reads "budget-lost IS: 62% vs 3%" as a
 * single line. The expander's layout (one campaign, many metrics) is the right
 * shape for diagnosing one campaign and the wrong shape for choosing between
 * two. Flipping the axes is the whole point of the screen.
 *
 * The daily-spend graph is deliberately NOT here (§10). Compare is about numbers
 * lining up; a row of small charts would take the vertical space that lets every
 * metric stay on screen at once, which is what makes the comparison a glance.
 *
 * Every figure comes from the same `campaignMetrics` derivation and the same
 * allocator line the expander reads, never a second calculation — a Compare grid
 * that disagreed with the panel it was opened from would be worse than no grid.
 */

import { XMarkIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate } from '@/lib/ad-pacer/helpers';
import type { AllocatorLine } from '@/lib/ad-pacer/google-allocator';
import { campaignMetrics, impressionShareText } from '@/lib/ad-pacer/google-metrics';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { Tooltip } from '@/app/app/tools/_shared';
import { PACE_COLORS, PACE_LABELS, campaignColor } from './google-pacing-theme';

/** One metric row: a label, an optional explanation, and how to read each column. */
interface CompareRow {
  label: string;
  tooltip?: string;
  /** Rendered per campaign. `muted` greys a state (not a measurement). */
  cell: (ctx: CompareCell) => { text: string; muted?: boolean; color?: string };
  /** Visually separates the delivery block from the money block. */
  startsGroup?: boolean;
}

interface CompareCell {
  line: AllocatorLine;
  metrics: ReturnType<typeof campaignMetrics>;
}

const pct = (v: number | null): string => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);

const ROWS: CompareRow[] = [
  {
    label: 'Lost IS (budget)',
    tooltip:
      'Share of impressions lost because the budget ran out. HIGH means the campaign has demand it is not funded for — the best candidate to receive budget. Search and Shopping only.',
    cell: ({ metrics }) => {
      const { text, muted } = impressionShareText(metrics.budgetLostIs);
      return { text, muted };
    },
  },
  {
    label: 'Lost IS (rank)',
    tooltip:
      'Share of impressions lost to Ad Rank — bid or Quality Score, not budget. HIGH means more money will just sit unspent, so do not feed it. It answers "will more budget help here", not "what should I fix".',
    cell: ({ metrics }) => {
      const { text, muted } = impressionShareText(metrics.rankLostIs);
      return { text, muted };
    },
  },
  {
    label: 'Cost / conv',
    tooltip:
      'Spend ÷ conversions, month to date. Held back below three conversions — a cost per conversion off one or two is noise, not a signal. Reference only: verify tracking in Google Ads.',
    cell: ({ metrics }) =>
      metrics.costPerConversion == null
        ? { text: '—', muted: true }
        : { text: fmt(metrics.costPerConversion) },
  },
  {
    label: 'Conv rate',
    tooltip:
      'Conversions ÷ interactions, month to date. Held back below three conversions, for the same reason as cost per conversion.',
    cell: ({ metrics }) =>
      metrics.convRate == null ? { text: '—', muted: true } : { text: pct(metrics.convRate) },
  },
  {
    label: 'Avg CPC',
    tooltip: 'Spend ÷ clicks, month to date.',
    cell: ({ metrics }) =>
      metrics.avgCpc == null ? { text: '—', muted: true } : { text: fmt(metrics.avgCpc) },
  },
  {
    label: 'CTR',
    tooltip: 'Clicks ÷ impressions, month to date.',
    cell: ({ metrics }) =>
      metrics.ctr == null ? { text: '—', muted: true } : { text: pct(metrics.ctr) },
  },
  {
    label: 'Pace',
    startsGroup: true,
    tooltip:
      'Spent month-to-date against what an even pace expects by the data edge. This is a TARGET read, not a delivery read — a campaign can be behind on the month while still spending its full daily.',
    cell: ({ line }) => ({
      text:
        line.paceRatio == null
          ? PACE_LABELS[line.paceStatus]
          : `${Math.round(line.paceRatio * 100)}% of pace`,
      color: PACE_COLORS[line.paceStatus],
    }),
  },
  {
    label: 'Current daily',
    tooltip: 'The average daily budget set in Google right now.',
    cell: ({ line }) =>
      line.currentDaily > 0 ? { text: `${fmt(line.currentDaily)}/day` } : { text: '—', muted: true },
  },
  {
    label: 'Recommended daily',
    tooltip:
      '(Monthly target − spent) ÷ remaining flight days. What the campaign needs to land on target — which assumes it can actually spend it, so read it next to Lost IS (budget) above.',
    cell: ({ line }) => ({ text: `${fmt(line.recommendedDaily)}/day`, color: 'var(--primary)' }),
  },
  {
    label: 'Remaining budget',
    tooltip:
      'Target − spent MTD. The same figure the Move tool caps at: what this campaign can still give away or still has left to spend.',
    cell: ({ line }) => ({ text: fmt(line.remainingBudget) }),
  },
];

export function GoogleCompareModal({
  lines,
  adsById,
  onClose,
  onMove,
}: {
  /** The selected campaigns, in table order. 2–4 by construction. */
  lines: readonly AllocatorLine[];
  adsById: Map<string, PacerAd>;
  onClose: () => void;
  /** Opens Move pre-loaded with this set (§9's second entry point). */
  onMove: () => void;
}) {
  const cells = lines.map((line) => ({
    line,
    metrics: campaignMetrics(adsById.get(line.id), line.spentMTD),
  }));
  // One stamp for the screen rather than one per column: the metrics all ride
  // the same account sync, so per-column stamps would repeat the same date four
  // times and imply they could differ.
  const asOf = cells.map((c) => c.metrics.asOf).find((d) => d != null) ?? null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-16"
      onClick={onClose}
    >
      <div
        className="glass-modal flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Compare {lines.length} campaigns
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Delivery and efficiency side by side{asOf ? ` · through ${fmtDate(asOf)}` : ''}. Read
              Lost IS (budget) first: it says which of these can actually absorb more money.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Wide grids scroll inside their own box rather than pushing the page
            sideways — four campaigns plus the label column outruns a narrow
            window. */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--card)] px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Metric
                </th>
                {cells.map(({ line }) => (
                  <th key={line.id} className="px-3 py-2 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-sm"
                        style={{ background: campaignColor(line.colorIndex) }}
                      />
                      <span className="truncate text-[12px] font-bold text-[var(--foreground)]">
                        {line.name}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr
                  key={row.label}
                  className={`border-t ${
                    row.startsGroup
                      ? 'border-t-2 border-[var(--border)]'
                      : 'border-[var(--border)]/50'
                  }`}
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-[var(--card)] px-2 py-2 text-left text-[11px] font-medium text-[var(--muted-foreground)]"
                  >
                    {row.tooltip ? (
                      <Tooltip label={row.tooltip}>
                        <span className="cursor-help">{row.label}</span>
                      </Tooltip>
                    ) : (
                      row.label
                    )}
                  </th>
                  {cells.map((ctx) => {
                    const out = row.cell(ctx);
                    return (
                      <td
                        key={ctx.line.id}
                        className={`px-3 py-2 text-right tabular-nums ${
                          out.muted
                            ? 'text-[11px] text-[var(--muted-foreground)]'
                            : 'text-[13px] font-semibold'
                        }`}
                        style={out.muted ? undefined : { color: out.color ?? 'var(--foreground)' }}
                      >
                        {out.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            Conversion figures are reference only and depend on this account&rsquo;s tracking setup
            — verify in Google Ads before acting on efficiency. Loomi does not rank these campaigns
            or pick the move for you.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-5 py-3.5">
          <span className="mr-auto text-[11px] text-[var(--muted-foreground)]">
            Move opens with these {lines.length} pre-loaded.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onMove}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: COLORS.lifetime }}
          >
            <ArrowsRightLeftIcon className="h-4 w-4" />
            Move budget
          </button>
        </div>
      </div>
    </div>
  );
}
