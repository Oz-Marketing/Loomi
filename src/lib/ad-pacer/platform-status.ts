// The read-only "Ad Status" — the campaign's ACTUAL delivery status from the
// platform, normalized to one shared vocabulary across Meta + Google so the
// planner can show it next to the team's editable Task Status (the `adStatus`
// field). Pure + unit-tested. This NEVER drives the Task Status or any
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
