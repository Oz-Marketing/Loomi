'use client';

// Google-specific slices of the shared PacerRow (§5). Kept in their own file so
// PacerRow only branches `platform === 'google'` in a few contained spots — the
// Meta path is untouched and the two channels can't drift. All the math lives in
// buildGooglePacingCard (pure, unit-tested); these are render-only.

import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate, fmtDaysLeft, fmtDaysNum } from '@/lib/ad-pacer/helpers';
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
 *  shared-budget badge (only when genuinely shared), the budget-limited /
 *  disapproved delivery chips (opposite remedies), and the ad-schedule badge
 *  (day-parted campaigns pace differently since June 2026). */
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
      {card.hasAdSchedule && (
        <Chip bg="rgba(250,204,21,0.16)" color="#facc15">
          Ad schedule
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

/** §5 the Google daily metric boxes that replace Meta's Remaining Budget +
 *  Rec Daily Adjustment: Days Remaining, Monthly Ceiling (daily × 30.4), and
 *  the recommendation box — the four-state engine's output. Only `adjust`
 *  hands over a number to type; on-track suppresses it, and delivery-limited /
 *  shortfall replace a misleading number with the honest thing. Rendered
 *  beside the shared Pacing Health + Projected boxes in PacerRow's grid. */
export function GoogleDailyMetricBoxes({
  card,
  hasDates,
  effectiveEnd,
}: {
  card: GooglePacingCard;
  hasDates: boolean;
  effectiveEnd: string | null;
}) {
  const rec = card.recommendation;
  // Never recommend raising the budget on a disapproved campaign — the rate is
  // sized right, the ads can't serve (§5). Surface "fix ads" instead of a bump.
  let recValue = card.target > 0 ? fmt(card.recommendedDaily) : '—';
  let recSub: string | undefined =
    card.target > 0 ? 'catch-up rate over remaining days' : 'set Target Spend';
  let recDetail: string | undefined;
  let recColor: string | undefined;
  if (card.disapproved) {
    recValue = 'Fix ads';
    recSub = 'ads disapproved';
    recDetail = 'Budget is sized right — disapproved ads are blocking delivery';
    recColor = COLORS.error;
  } else if (rec) {
    switch (rec.state) {
      case 'on_track':
        recValue = 'No change';
        recSub = 'ceiling matches target, delivering';
        recDetail = 'Leave it — Google paces to the monthly ceiling';
        recColor = COLORS.success;
        break;
      case 'adjust':
        recValue = fmt(rec.requiredRate);
        recSub = `${fmt(Math.max(0, rec.remainingBudget))} left ÷ ${fmtDaysNum(card.daysRemaining)}d — catch-up rate`;
        recDetail =
          rec.direction === 'trim'
            ? `Lower the daily from ${fmt(card.dailyBudget)} to land on target${rec.largeJump ? ' — large change, monitor it' : ''}`
            : `Raise the daily from ${fmt(card.dailyBudget)} to land on target${rec.largeJump ? ' — large jump, stage it and monitor' : ''}`;
        recColor = rec.direction === 'trim' ? COLORS.lifetime : COLORS.warn;
        break;
      case 'delivery_limited':
        recValue = 'Diagnose delivery';
        recSub =
          rec.health.pacingRatio != null
            ? `spending ${(rec.health.pacingRatio * 100).toFixed(0)}% of ceiling pace`
            : 'underdelivering';
        recDetail =
          'Raising the daily won’t help — check search volume, bids, ad rank, schedule';
        recColor = COLORS.error;
        break;
      case 'shortfall':
        recValue = `Short ~${fmt(rec.gap)}`;
        recSub = `${fmt(Math.max(0, rec.remainingBudget))} left · ~${fmt(rec.recoverableMax)} max billable`;
        recDetail = 'Reallocate the unspendable budget, or accept the miss';
        recColor = COLORS.error;
        break;
    }
  }
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
        detail="The real cap — Google bills at most daily × 30.4 per calendar month"
        color={card.ceilingShortOfTarget ? COLORS.warn : COLORS.success}
      />
      <MetricBox
        label="Rec. Daily Rate"
        value={card.target > 0 ? recValue : '—'}
        sub={recSub}
        detail={recDetail}
        color={recColor}
      />
    </>
  );
}

/** §5/§7 the pacing footnote — budget-limited and disapproved keep their
 *  OPPOSITE advice; otherwise the four-state engine speaks: on-track
 *  suppresses, adjust hands over the catch-up rate, delivery-limited says
 *  diagnose (never raise), shortfall states the honest gap. */
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
  const rec = card.recommendation;
  if (rec) {
    switch (rec.state) {
      case 'delivery_limited':
        return (
          <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.error }}>
            Spending{' '}
            {rec.health.pacingRatio != null
              ? `${(rec.health.pacingRatio * 100).toFixed(0)}%`
              : 'well short'}{' '}
            of the pace needed to reach its {fmt(rec.effectiveCeiling)} ceiling — the campaign
            can&apos;t spend its current budget, so raising the daily does nothing. Check search
            volume, bids, ad rank/quality, and the schedule.
          </p>
        );
      case 'shortfall':
        return (
          <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.error }}>
            Can&apos;t recover: {fmt(Math.max(0, rec.remainingBudget))} remains but at most ~
            {fmt(rec.recoverableMax)} can still bill (2× the daily) by {endLabel} — short ~
            {fmt(rec.gap)}. Reallocate to a campaign that can absorb it, or accept the miss.
          </p>
        );
      case 'adjust':
        if (rec.direction === 'trim') {
          return (
            <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.warn }}>
              The {fmt(rec.effectiveCeiling)} ceiling overshoots the {fmt(card.target)} target —
              Google will pace toward it. Set the daily to {fmt(rec.requiredRate)} to land the
              month on target by {endLabel}.
            </p>
          );
        }
        return (
          <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.lifetime }}>
            The current rate&apos;s ceiling ({fmt(rec.effectiveCeiling)}) falls short of the{' '}
            {fmt(card.target)} target. Set the daily to {fmt(rec.requiredRate)} — the catch-up
            rate over the remaining days
            {rec.largeJump ? ' (a large jump — stage it and monitor)' : ''}.
          </p>
        );
      case 'on_track':
        return (
          <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.success }}>
            On track — the monthly ceiling matches the target and delivery is healthy. Single-day
            swings up to 2× the daily are normal; the {fmt(rec.effectiveCeiling)} ceiling is the
            real cap.
          </p>
        );
    }
  }
  if (card.ceilingShortOfTarget) {
    return (
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: COLORS.warn }}>
        The current rate&apos;s ceiling ({fmt(card.monthlyCeiling)}) falls short of the{' '}
        {fmt(card.target)} target. Raise the daily rate to {fmt(card.recommendedDaily)} to close
        the gap.
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
