/**
 * Presentation constants for the Google pacing card. Kept out of the component so
 * the card, the allocation meter, and the health popup can't drift apart on the
 * one thing that ties a row to a bar: its color.
 */

import { COLORS } from '@/lib/ad-pacer/constants';
import type { PaceStatus } from '@/lib/ad-pacer/google-allocator';

/**
 * Per-campaign identity colors. Assigned by row index and reused verbatim in the
 * segmented allocation meter, the row chip, the move-panel chips, and the health
 * popup header — a color that means one campaign in the bar and another in the
 * table is worse than no color at all.
 *
 * Longer than the shared AD_COLORS rotation because a Google account routinely
 * carries a dozen-plus campaigns, and a rotation shorter than the table repeats
 * inside a single meter.
 */
export const CAMPAIGN_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#4ade80',
  '#c084fc',
  '#f87171',
  '#2dd4bf',
  '#fbbf24',
  '#818cf8',
] as const;

export const campaignColor = (index: number): string =>
  CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length];

/** Pace-badge palette. `under` borrows the lifetime violet rather than an alarm
 *  color: underspending is a thing to fix, not a failure, and the card already
 *  reserves red for "the ads can't serve". */
export const PACE_COLORS: Record<PaceStatus, string> = {
  on: COLORS.success,
  over: COLORS.warn,
  under: COLORS.lifetime,
  none: 'var(--muted-foreground)',
};

export const PACE_LABELS: Record<PaceStatus, string> = {
  on: 'On track',
  over: 'Overspending',
  under: 'Underspending',
  none: 'No data',
};
