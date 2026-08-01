/**
 * The budget module's channel list — the spend axis every BudgetLine is
 * eventually placed on.
 *
 * Client-safe (no server imports), in the shape of `ad-pacer/constants.ts`.
 * Channels are string KEYS, never numeric ids: oz-reports scattered
 * `$GOOGLE = 2; $FACEBOOK = 1; $YOUTUBE = 6` through its calc code and every
 * reader had to know the mapping. Nothing here or downstream may hardcode a
 * channel — look it up.
 *
 * A channel with a `pacer` platform is one the module can bind to an Ad Pacer
 * plan and (eventually) push a budget for. Everything else settles by hand.
 */

export type PacerPlatform = 'meta' | 'google';

export interface BudgetChannel {
  key: string;
  label: string;
  /** Display grouping in the hub — purely presentational. */
  category: 'Digital' | 'Traditional' | 'Production' | 'Other';
  /**
   * Ad Pacer platform this channel's budget rolls into, when any. Both
   * `google` and `youtube` map to the Google pacer: the pacer's grain is the
   * Google campaign, and YouTube/Demand Gen campaigns live in the same
   * customer account. Keeping them as separate BUDGET channels preserves the
   * planning split the reps use (and that oz-reports modeled as channels 2/6)
   * without pretending the pacer sees two accounts.
   */
  pacer?: PacerPlatform;
}

export const BUDGET_CHANNELS: readonly BudgetChannel[] = [
  { key: 'meta', label: 'Meta', category: 'Digital', pacer: 'meta' },
  { key: 'google', label: 'Google Search', category: 'Digital', pacer: 'google' },
  { key: 'youtube', label: 'YouTube', category: 'Digital', pacer: 'google' },
  { key: 'ott', label: 'OTT / CTV', category: 'Digital' },
  { key: 'email_sms', label: 'Email / SMS', category: 'Digital' },
  { key: 'radio', label: 'Radio', category: 'Traditional' },
  { key: 'tv', label: 'TV', category: 'Traditional' },
  { key: 'billboard', label: 'Billboard', category: 'Traditional' },
  { key: 'print', label: 'Print / Mailer', category: 'Traditional' },
  { key: 'video', label: 'Video / Photo', category: 'Production' },
  { key: 'pr', label: 'PR / Sponsorship', category: 'Other' },
] as const;

const BY_KEY = new Map(BUDGET_CHANNELS.map((c) => [c.key, c]));

export function budgetChannel(key: string | null | undefined): BudgetChannel | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

export function isBudgetChannel(key: string | null | undefined): boolean {
  return !!key && BY_KEY.has(key);
}

export function channelLabel(key: string | null | undefined): string {
  return budgetChannel(key)?.label ?? 'Unassigned';
}

/** Display grouping for a channel; drives the hub's section headers. */
export function channelCategory(key: string | null | undefined): string | null {
  return budgetChannel(key)?.category ?? null;
}

/** The pacer platform a channel's budget rolls into, or null if it settles manually. */
export function channelPacerPlatform(key: string | null | undefined): PacerPlatform | null {
  return budgetChannel(key)?.pacer ?? null;
}

/** Channel keys feeding one pacer platform — the WHERE-IN for the period-budget rollup. */
export function channelsForPlatform(platform: PacerPlatform): string[] {
  return BUDGET_CHANNELS.filter((c) => c.pacer === platform).map((c) => c.key);
}

/** True when this channel's spend can be reconciled from a synced platform. */
export function isPacedChannel(key: string | null | undefined): boolean {
  return channelPacerPlatform(key) != null;
}

/**
 * Task kind (Projects intake) → the channel its budget defaults to. Kinds that
 * can span channels (`ads`) are deliberately absent: the intake form asks which
 * channels, and one line is created per selected channel.
 */
export const KIND_DEFAULT_CHANNEL: Record<string, string> = {
  print: 'print',
  email: 'email_sms',
  sms: 'email_sms',
  video: 'video',
  pr: 'pr',
};

/**
 * The `ads` intake field offers platform names; map them onto channel keys.
 * Unmapped selections (TikTok, KSL) have no budget channel yet and fall back to
 * a single generic Meta/Google-less line — see intake wiring.
 */
export const ADS_CHANNEL_OPTION_MAP: Record<string, string> = {
  Facebook: 'meta',
  Google: 'google',
  SEM: 'google',
  YouTube: 'youtube',
};
