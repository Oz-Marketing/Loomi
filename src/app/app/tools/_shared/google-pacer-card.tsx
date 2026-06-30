'use client';

// Google-specific slices of the shared PacerRow (§5). Kept in their own file so
// PacerRow only branches `platform === 'google'` in a few contained spots — the
// Meta path is untouched and the two channels can't drift. All the math lives in
// buildGooglePacingCard (pure, unit-tested); these are render-only.

import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate, fmtDaysLeft } from '@/lib/ad-pacer/helpers';
import type { GooglePacingCard } from '@/lib/ad-pacer/google-pacer-calc';
import { MetricBox } from './metrics';

function Chip({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span
      className="font-bold uppercase tracking-wider px-2 py-0.5 rounded text-[10px] whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  );
}

/** §2/§5 badges for the expanded card header: Daily/Total pacing type, the
 *  shared-budget badge (only when genuinely shared), and the budget-limited /
 *  disapproved delivery chips (opposite remedies). */
export function GooglePacingBadges({ card }: { card: GooglePacingCard }) {
  return (
    <>
      <Chip bg="rgba(56,189,248,0.16)" color={COLORS.daily}>
        {card.pacingType}
      </Chip>
      {card.shared && (
        <Chip bg="rgba(125,184,232,0.16)" color="#7db8e8">
          Shared{card.sharedCount ? ` ×${card.sharedCount}` : ''}
        </Chip>
      )}
      {card.budgetLimited && (
        <Chip bg="rgba(125,184,232,0.16)" color="#7db8e8">
          Capped · has headroom
        </Chip>
      )}
      {card.disapproved && (
        <Chip bg="rgba(248,113,113,0.16)" color="#f87171">
          Ads disapproved
        </Chip>
      )}
    </>
  );
}

/** §5 the three Google daily metric boxes that replace Meta's Remaining Budget +
 *  Rec Daily Adjustment: Days Remaining, Monthly Ceiling (daily × 30.4), and the
 *  recommended daily RATE (target ÷ 30.4). Rendered beside the shared Projected
 *  box inside PacerRow's metric grid. */
export function GoogleDailyMetricBoxes({
  card,
  hasDates,
  effectiveEnd,
}: {
  card: GooglePacingCard;
  hasDates: boolean;
  effectiveEnd: string | null;
}) {
  // Never recommend raising the budget on a disapproved campaign — the rate is
  // sized right, the ads can't serve (§5). Surface "fix ads" instead of a bump.
  const recDetail = card.disapproved
    ? 'Ads disapproved — fix the ads, not the budget'
    : card.ceilingShortOfTarget
      ? `Raise daily to ${fmt(card.recommendedDaily)} — current ceiling falls short`
      : 'Ceiling clears the target';
  const recColor = card.disapproved
    ? COLORS.error
    : card.ceilingShortOfTarget
      ? COLORS.warn
      : COLORS.success;
  return (
    <>
      <MetricBox
        label="Days Remaining"
        value={hasDates ? fmtDaysLeft(card.daysRemaining) : '—'}
        sub={hasDates && effectiveEnd ? `until ${fmtDate(effectiveEnd)}` : 'set flight dates'}
      />
      <MetricBox
        label="Monthly Ceiling"
        value={card.monthlyCeiling > 0 ? fmt(card.monthlyCeiling) : '—'}
        sub={`${fmt(card.dailyBudget)}/day × 30.4`}
        detail="The real cap — daily budgets are averages, not hard caps"
        color={card.ceilingShortOfTarget ? COLORS.warn : COLORS.success}
      />
      <MetricBox
        label="Rec. Daily Rate"
        value={card.target > 0 ? fmt(card.recommendedDaily) : '—'}
        sub={card.target > 0 ? `${fmt(card.target)} target ÷ 30.4` : 'set Target Spend'}
        detail={recDetail}
        color={recColor}
      />
    </>
  );
}

/** §5 the pacing footnote — budget-limited and disapproved get OPPOSITE advice;
 *  a daily campaign over its ceiling is running hot; otherwise the on-track note
 *  reminds that 2× daily swings are normal and the ceiling is the real cap. */
export function GooglePacingInsight({
  card,
  effectiveEnd,
}: {
  card: GooglePacingCard;
  effectiveEnd: string | null;
}) {
  const endLabel = effectiveEnd ? fmtDate(effectiveEnd) : 'month end';
  if (card.disapproved) {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.lifetime }}>
        Under target, but not a budget problem — the daily rate is sized to reach{' '}
        {fmt(card.target)}; disapproved ads are blocking delivery. Fix the disapprovals; raising
        the budget won&apos;t help.
      </p>
    );
  }
  if (card.budgetLimited) {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.success }}>
        At cap with headroom — this campaign spends its full budget every day and could absorb
        more. Point unallocated pool budget here to capture the demand.
      </p>
    );
  }
  if (card.pacingType === 'Total') {
    return (
      <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        Google paces this total budget to its end date and won&apos;t exceed it, so variance is
        near zero by design. A shortfall here signals an interruption, not a pacing miss.
      </p>
    );
  }
  if (card.ceilingShortOfTarget) {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.warn }}>
        The current rate&apos;s ceiling ({fmt(card.monthlyCeiling)}) falls short of the{' '}
        {fmt(card.target)} target. Raise the daily rate to {fmt(card.recommendedDaily)} so its 30.4
        ceiling clears the allocation.
      </p>
    );
  }
  if (card.status === 'over') {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.warn }}>
        Projected {fmt(card.projected)} is above the {fmt(card.monthlyCeiling)} ceiling — running
        hot. Lower the daily rate to bring the month-end projection back under the cap by {endLabel}.
      </p>
    );
  }
  if (card.status === 'under') {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.lifetime }}>
        Trending short of the {fmt(card.target)} target. Bumping the daily rate toward{' '}
        {fmt(card.recommendedDaily)} pulls the month-end projection up to plan.
      </p>
    );
  }
  return (
    <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.success }}>
      On track. A daily budget can spend up to 2× on a busy day, so single-day swings are normal —
      the {fmt(card.monthlyCeiling)} monthly ceiling is the real cap.
    </p>
  );
}
