// The read-only "Ad Status" — the campaign's ACTUAL delivery status from the
// platform, normalized to one shared vocabulary across Meta + Google so the
// planner can show it next to the team's editable Ad Status (the `adStatus`
// field). Pure + unit-tested. This NEVER drives the editable Ad Status or any
// automation; it's display-only platform truth.

import type { PacerAd } from './types';

export type PlatformAdStatus =
  | 'Active'
  | 'Paused'
  | 'Limited' // delivering but capped/constrained (Google BUDGET_CONSTRAINED)
  | 'Disapproved' // ads can't serve (policy)
  | 'Removed'
  | 'Not linked' // no platform object linked to this row yet
  | 'Unknown';

/**
 * Derive the normalized platform Ad Status for a pacer row. Reads the synced
 * platform fields only:
 *  • Google — googleEffectiveStatus (ENABLED/PAUSED/REMOVED) refined by the §5
 *    delivery signals (adsDisapproved → Disapproved, budgetConstrained →
 *    Limited). Unlinked rows (no googleCampaignId) → Not linked.
 *  • Meta — metaEffectiveStatus (ACTIVE/PAUSED/…). Unlinked rows (no
 *    metaObjectId) → Not linked.
 */
export function normalizeAdStatus(ad: PacerAd): PlatformAdStatus {
  const isGoogle = ad.platform === 'google';

  if (isGoogle) {
    if (!ad.googleCampaignId) return 'Not linked';
    // Disapproval wins — the ad literally can't serve, whatever the status says.
    if (ad.googleAdsDisapproved) return 'Disapproved';
    switch ((ad.googleEffectiveStatus ?? '').toUpperCase()) {
      case 'ENABLED':
        return ad.googleBudgetConstrained ? 'Limited' : 'Active';
      case 'PAUSED':
        return 'Paused';
      case 'REMOVED':
        return 'Removed';
      default:
        return 'Unknown';
    }
  }

  if (!ad.metaObjectId) return 'Not linked';
  switch ((ad.metaEffectiveStatus ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Active';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
      return 'Paused';
    case 'DISAPPROVED':
      return 'Disapproved';
    case 'WITH_ISSUES':
    case 'PENDING_REVIEW':
      return 'Limited';
    case 'DELETED':
    case 'ARCHIVED':
      return 'Removed';
    default:
      return 'Unknown';
  }
}

/** Tone bucket for the status pill — maps to the shared COLORS in the UI. */
export function adStatusTone(
  status: PlatformAdStatus,
): 'good' | 'warn' | 'bad' | 'muted' {
  switch (status) {
    case 'Active':
      return 'good';
    case 'Limited':
    case 'Paused':
      return 'warn';
    case 'Disapproved':
      return 'bad';
    default:
      return 'muted'; // Removed / Not linked / Unknown
  }
}

// ── Loomi-vs-platform mismatch (delivery/reallocation spec §13) ──

import { ACTIVE_STATUSES } from './constants';

/**
 * Google's `campaign.primary_status_reasons` enums, in plain English. Only the
 * ones a pacing desk can act on are spelled out; anything else falls through to
 * a humanized form of the enum rather than being hidden, because an unexplained
 * reason still tells you where to look in Google.
 */
const REASON_COPY: Record<string, string> = {
  CAMPAIGN_REMOVED: 'the campaign was removed',
  CAMPAIGN_PAUSED: 'the campaign is paused',
  CAMPAIGN_PENDING: 'the campaign has not started yet',
  CAMPAIGN_ENDED: 'the campaign’s end date has passed',
  CAMPAIGN_DRAFT: 'the campaign is still a draft',
  BUDGET_CONSTRAINED: 'it is limited by its budget',
  BUDGET_MISCONFIGURED: 'its budget is misconfigured',
  SEARCH_VOLUME_LIMITED: 'there is too little search volume',
  AD_GROUPS_PAUSED: 'every ad group is paused',
  NO_AD_GROUPS: 'it has no ad groups',
  ADS_PAUSED: 'every ad is paused',
  NO_ADS: 'it has no ads',
  HAS_ADS_DISAPPROVED: 'some ads are disapproved',
  HAS_ADS_LIMITED_BY_POLICY: 'some ads are limited by policy',
  MOST_ADS_UNDER_REVIEW: 'most ads are still under review',
  BID_STRATEGY_MISCONFIGURED: 'its bid strategy is misconfigured',
  BID_STRATEGY_LIMITED: 'its bid strategy is limiting delivery',
  BID_STRATEGY_LEARNING: 'its bid strategy is still learning',
  LOW_QUALITY: 'its quality score is low',
};

/** Parse the stored JSON reason list. Never throws — a malformed value yields
 *  no reasons rather than taking the row's render down with it. */
export function parseStatusReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

/** One reason enum in plain English. */
export function statusReasonText(reason: string): string {
  return (
    REASON_COPY[reason] ??
    reason.toLowerCase().replace(/_/g, ' ')
  );
}

/**
 * The same reasons as SHORT LABELS, for the collapsed row's status line
 * (budget-report addendum §2.1). The sentence forms above are written to be read
 * inside a paragraph in the delivery panel ("… because it is limited by its
 * budget"); on a row they have to fit beside a campaign name, so they are the
 * noun phrase instead: "Limited by budget".
 */
const REASON_LABEL: Record<string, string> = {
  CAMPAIGN_REMOVED: 'Removed',
  CAMPAIGN_PAUSED: 'Campaign paused',
  CAMPAIGN_PENDING: 'Not started',
  CAMPAIGN_ENDED: 'Ended',
  CAMPAIGN_DRAFT: 'Draft',
  BUDGET_CONSTRAINED: 'Limited by budget',
  BUDGET_MISCONFIGURED: 'Budget misconfigured',
  SEARCH_VOLUME_LIMITED: 'Low search volume',
  AD_GROUPS_PAUSED: 'Ad groups paused',
  NO_AD_GROUPS: 'No ad groups',
  ADS_PAUSED: 'Ads paused',
  NO_ADS: 'No ads',
  HAS_ADS_DISAPPROVED: 'Ads disapproved',
  HAS_ADS_LIMITED_BY_POLICY: 'Ads limited by policy',
  MOST_ADS_UNDER_REVIEW: 'Ads under review',
  BID_STRATEGY_MISCONFIGURED: 'Bid strategy misconfigured',
  BID_STRATEGY_LIMITED: 'Bid strategy limiting',
  BID_STRATEGY_LEARNING: 'Bid strategy learning',
  LOW_QUALITY: 'Low quality score',
};

/** One reason enum as a short row label. Unknown enums humanize rather than
 *  disappear — an unexplained reason still says where to look in Google. */
export function statusReasonLabel(reason: string): string {
  const known = REASON_LABEL[reason];
  if (known) return known;
  const words = reason.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Severity of one status reason (spec additions §A.2).
 *
 * When the right-of-name status dot was retired, the thing it carried was
 * SEVERITY, and the quiet status line that replaced it printed a disapproval and
 * a healthy "Eligible" in the same gray. This puts the tone back, on the reason
 * rather than on the whole line, keyed the way Google keys it:
 *
 *  - **bad** — the ads cannot serve. A fault to fix, and the one case where red
 *    is right: every number on the row is fiction until it is fixed.
 *  - **warn** — serving, but something is holding delivery back. "Limited by
 *    budget" is the common one, and it is the pacing desk's own business.
 *  - **neutral** — a state, not a problem: paused on purpose, not started yet,
 *    still learning. An unknown enum lands here too, because inventing an alarm
 *    for a reason we have not mapped is worse than printing it plainly.
 *
 * Deliberately NOT applied to the Enabled/Paused word beside it: a campaign that
 * is enabled and budget-limited is enabled, and coloring the word off the reason
 * next to it would say the switch itself was the problem.
 */
export type StatusReasonTone = 'neutral' | 'warn' | 'bad';

const REASON_TONE: Record<string, StatusReasonTone> = {
  // Cannot serve, or is configured wrongly.
  CAMPAIGN_REMOVED: 'bad',
  BUDGET_MISCONFIGURED: 'bad',
  BID_STRATEGY_MISCONFIGURED: 'bad',
  NO_AD_GROUPS: 'bad',
  NO_ADS: 'bad',
  AD_GROUPS_PAUSED: 'bad',
  ADS_PAUSED: 'bad',
  HAS_ADS_DISAPPROVED: 'bad',
  // Serving, but constrained.
  BUDGET_CONSTRAINED: 'warn',
  SEARCH_VOLUME_LIMITED: 'warn',
  BID_STRATEGY_LIMITED: 'warn',
  LOW_QUALITY: 'warn',
  HAS_ADS_LIMITED_BY_POLICY: 'warn',
  MOST_ADS_UNDER_REVIEW: 'warn',
  // States, not problems.
  CAMPAIGN_PAUSED: 'neutral',
  CAMPAIGN_PENDING: 'neutral',
  CAMPAIGN_ENDED: 'neutral',
  CAMPAIGN_DRAFT: 'neutral',
  BID_STRATEGY_LEARNING: 'neutral',
};

export function statusReasonTone(reason: string): StatusReasonTone {
  return REASON_TONE[reason] ?? 'neutral';
}

/** The worst tone across a reason list — what the status line as a whole is
 *  saying. Empty (a plain "Eligible") is neutral, which is the point: nothing
 *  is wrong, so nothing is colored. */
export function statusLineTone(reasons: readonly string[]): StatusReasonTone {
  let tone: StatusReasonTone = 'neutral';
  for (const reason of reasons) {
    const t = statusReasonTone(reason);
    if (t === 'bad') return 'bad';
    if (t === 'warn') tone = 'warn';
  }
  return tone;
}

/**
 * Whether the campaign is switched on, off, or cannot run at all — the state the
 * status word's own indicator shows (§A.2), kept apart from the reason's tone so
 * "Enabled" never turns red because of the warning printed next to it.
 */
export function statusWordState(word: string | null): 'on' | 'off' | 'fault' {
  if (word === 'Enabled') return 'on';
  if (word === 'Not eligible' || word === 'Removed') return 'fault';
  return 'off';
}

/**
 * Google's own word for whether the campaign is switched on — the first thing
 * on the row's status line (addendum §2.1). Reads `campaign.primary_status`,
 * falling back to the effective status for rows synced before primary status
 * was stored.
 *
 * ELIGIBLE / LIMITED / LEARNING all collapse to "Enabled": they are all a
 * running campaign, and WHY it is limited or learning is the reason that
 * follows. Null when there is nothing synced to report.
 */
export function platformStatusWord(ad: PacerAd): string | null {
  const raw = (ad.googlePrimaryStatus ?? ad.googleEffectiveStatus ?? '').toUpperCase();
  switch (raw) {
    case 'ELIGIBLE':
    case 'LIMITED':
    case 'LEARNING':
    case 'ENABLED':
      return 'Enabled';
    case 'PAUSED':
      return 'Paused';
    case 'REMOVED':
      return 'Removed';
    case 'ENDED':
      return 'Ended';
    case 'PENDING':
      return 'Not started';
    case 'NOT_ELIGIBLE':
      return 'Not eligible';
    default:
      return null;
  }
}

export type StatusMismatch =
  /** Loomi is pacing this as live; Google says it cannot serve. The expensive
   *  one — every recommended daily on this row is a number for a campaign that
   *  is not running, and pushing it changes nothing. */
  | { kind: 'not_serving'; platform: PlatformAdStatus; reasons: string[] }
  /** Loomi has it parked; Google is running it. Money is moving on a line the
   *  plan is not pacing. */
  | { kind: 'unexpectedly_live'; platform: PlatformAdStatus; reasons: string[] }
  | null;

/**
 * Does the team's editable Ad Status contradict what Google actually reports
 * (§13)? Both directions are worth surfacing, for opposite reasons: a "live"
 * row that isn't serving makes every number on it fiction, and an "off" row
 * that IS serving is unplanned spend.
 *
 * Deliberately NOT auto-corrective. It never rewrites adStatus — the team's
 * status carries intent ("this is meant to be running") that Google cannot
 * know, and silently overwriting it would erase the very disagreement worth
 * seeing. Display only.
 */
export function statusMismatch(ad: PacerAd): StatusMismatch {
  // Only Google rows: Meta's status vocabulary maps differently and its pacer
  // does not carry this warning.
  if (ad.platform !== 'google') return null;
  const platform = normalizeAdStatus(ad);
  const reasons = parseStatusReasons(ad.googlePrimaryStatusReasons);
  const loomiSaysLive = ACTIVE_STATUSES.includes(ad.adStatus);

  // "Not linked" is a setup gap, not a contradiction — the row has no Google
  // campaign to disagree with, and the card already says so elsewhere.
  if (platform === 'Not linked' || platform === 'Unknown') return null;

  if (loomiSaysLive && (platform === 'Paused' || platform === 'Removed')) {
    return { kind: 'not_serving', platform, reasons };
  }
  // Anything not in the active set is "the team is not treating this as live".
  // Completed Run is excluded: a finished flight still reading ENABLED in Google
  // is ordinary at month end, not a surprise.
  if (
    !loomiSaysLive &&
    ad.adStatus !== 'Completed Run' &&
    (platform === 'Active' || platform === 'Limited')
  ) {
    return { kind: 'unexpectedly_live', platform, reasons };
  }
  return null;
}
