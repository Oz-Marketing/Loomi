'use client';

import { useMemo } from 'react';
import { TableCellsIcon } from '@heroicons/react/24/outline';
import type { PacerPlan } from '@/lib/ad-pacer/types';
import { COLORS, AD_COLORS } from '@/lib/ad-pacer/constants';
import {
  fmt,
  num,
  effMarkupOf,
  sourceColor,
  sourceTint,
  sourceLabel,
  budgetTypeColor,
  budgetTypeTint,
  fmtFullDate,
} from '@/lib/ad-pacer/helpers';
import { buildAdCalc } from '@/lib/ad-pacer/pacer-calc';
import { SectionLabel } from '@/app/app/tools/_shared';

// Meta planner Summary tab. Split out of MetaAdsPlannerTool to shrink the file.
export function SummaryPanel({ plan }: { plan: PacerPlan }) {
  const calcs = useMemo(
    () => plan.ads.map((ad) => buildAdCalc(ad, Date.now(), plan.timeZone)),
    [plan],
  );
  const totalProjected = calcs.reduce((s, c) => s + c.projected, 0);
  const totalActual = calcs.reduce((s, c) => s + (c.actual ?? 0), 0);
  const totalTarget = calcs.reduce((s, c) => s + (c.target ?? 0), 0);
  const baseGoal = num(plan.baseBudgetGoal);
  const addedGoal = num(plan.addedBudgetGoal);
  const combinedGoal =
    baseGoal != null || addedGoal != null ? (baseGoal ?? 0) + (addedGoal ?? 0) : null;

  if (plan.ads.length === 0) {
    return (
      <div className="glass-section-card rounded-xl px-6 py-12 text-center">
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">No ads yet</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Add at least one ad in the Budgeting tab to see a summary.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-section-card rounded-xl px-5 py-4">
      <SectionLabel icon={<TableCellsIcon className="w-3 h-3" />} text="Summary Table" />
      {(baseGoal != null || addedGoal != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Base Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.base }}>
              {baseGoal != null ? fmt(baseGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Added Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.added }}>
              {addedGoal != null ? fmt(addedGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Combined Total
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--foreground)]">
              {combinedGoal != null ? fmt(combinedGoal) : '—'}
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                'Ad Name',
                'Type',
                'Source',
                'Date Range',
                'Days',
                'Budget',
                'Projected',
                'Actual',
                'Target',
                'Rec. Daily',
                'Δ Budget',
              ].map((h) => (
                <th
                  key={h}
                  className="px-2.5 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calcs.map((c, i) => (
              <tr key={c.ad.id} className="border-b border-[var(--border)]">
                <td className="px-2.5 py-2.5 text-[var(--foreground)] max-w-[160px] truncate">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle"
                    style={{ background: AD_COLORS[i % AD_COLORS.length] }}
                  />
                  {c.ad.name}
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: budgetTypeTint(c.ad.budgetType),
                      color: budgetTypeColor(c.ad.budgetType),
                    }}
                  >
                    {c.ad.budgetType}
                  </span>
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: sourceTint(c.ad.budgetSource),
                      color: sourceColor(c.ad.budgetSource),
                    }}
                  >
                    {sourceLabel(c.ad.budgetSource)}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)] whitespace-nowrap">
                  {c.ad.flightStart && c.ad.flightEnd
                    ? `${fmtFullDate(c.ad.flightStart)} → ${fmtFullDate(c.ad.flightEnd)}`
                    : '—'}
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)]">
                  {c.days > 0 ? c.days : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{ color: budgetTypeColor(c.ad.budgetType) }}
                >
                  {fmt(c.totalBudget)}
                  <span className="ml-1 text-[9px] text-[var(--muted-foreground)]">
                    {c.isLifetime ? 'total' : '/day'}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--foreground)]">
                  {fmt(c.projected)}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.actual != null ? COLORS.lifetime : 'var(--muted-foreground)',
                    opacity: c.actual != null ? 1 : 0.6,
                  }}
                >
                  {c.actual != null ? fmt(c.actual) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.target != null ? 'var(--foreground)' : 'var(--muted-foreground)',
                    opacity: c.target != null ? 1 : 0.6,
                  }}
                >
                  {c.target != null ? fmt(c.target) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color:
                      c.recDaily != null ? COLORS.success : 'var(--muted-foreground)',
                    opacity: c.recDaily != null ? 1 : 0.6,
                  }}
                >
                  {c.isLifetime ? (
                    <span className="text-[var(--muted-foreground)]">n/a</span>
                  ) : c.recDaily != null ? (
                    fmt(c.recDaily)
                  ) : (
                    '—'
                  )}
                </td>
                <td
                  className="px-2.5 py-2.5 font-bold"
                  style={{
                    color:
                      c.delta == null
                        ? 'var(--muted-foreground)'
                        : c.delta > 0
                          ? COLORS.success
                          : c.delta < 0
                            ? COLORS.error
                            : 'var(--foreground)',
                    opacity: c.delta == null ? 0.6 : 1,
                  }}
                >
                  {c.delta != null ? `${c.delta >= 0 ? '+' : ''}${fmt(c.delta)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)]">
              <td
                colSpan={5}
                className="px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Totals
              </td>
              <td className="px-2.5 py-2.5 text-[9px] text-[var(--muted-foreground)]">
                —
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.daily }}
              >
                {fmt(totalProjected)}
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.lifetime }}
              >
                {totalActual > 0 ? fmt(totalActual) : '—'}
              </td>
              <td className="px-2.5 py-2.5 font-bold text-[var(--foreground)]">
                {totalTarget > 0 ? fmt(totalTarget) : '—'}
              </td>
              <td colSpan={2} />
            </tr>
            {combinedGoal != null && (
              <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                <td
                  colSpan={5}
                  className="px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Combined Budget Goal
                </td>
                <td colSpan={6} className="px-2.5 py-2.5">
                  <span className="text-[var(--foreground)] font-bold">
                    {fmt(Math.round(combinedGoal * effMarkupOf(plan.markup) * 100) / 100)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> actual / </span>
                  <span style={{ color: COLORS.daily }} className="font-bold">
                    {fmt(combinedGoal)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> gross client</span>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}


// ─── Import from Meta (onboarding) ──────────────────────────────────────────

// ─── Main tool component ───────────────────────────────────────────────────
/**
 * Shared shell rendered by both the Ad Planner and Ad Pacer pages. The
 * `mode` prop controls which surface is shown. In `pacer` mode the page
 * header gets a Pacer | Summary toggle that swaps the body content.
 */
