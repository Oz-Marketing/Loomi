/**
 * The budget module's channel registry — the spend axis every BudgetLine is
 * eventually placed on.
 *
 * Mirrors Oz Reports' `channels` table one-for-one (see docs/budget-module.md
 * §6). That table is the agency's real taxonomy and about half its dollars sit
 * in categories that aren't media at all — fees, data feeds, lead providers,
 * contributions. A media-only registry would make the hub show roughly half of
 * each client's actual budget, which is worse than showing none: the moment
 * anyone reconciles against Oz Reports the number stops being trusted.
 *
 * Three things a channel carries beyond its name:
 *
 *   `ozIds`  — the Oz Reports channel_id(s) this maps from, used by the import.
 *              A list because ids 30 and 40 are both "Management Fee".
 *   `pacer`  — the Ad Pacer platform its budget rolls into, when any. Only the
 *              three ad channels have one; everything else settles by hand.
 *   `intake` — whether a rep can pick it when filing a ticket. All 44 exist so
 *              the hub reconciles; only the ones people actually request are
 *              offered on the form. Nobody filing an ads ticket should be
 *              choosing "Contribution".
 *
 * UNIVERSAL — no 'use client', no server imports. Both sides need it: the hub
 * and intake render channel labels and icons, and the Oz Reports import
 * resolves `ozIds` on the server. Marking it 'use client' made every export a
 * client reference that threw the moment a route handler called it, which is
 * exactly how the first real import run failed — with 988 passing tests, because
 * vitest runs plain Node where the directive is inert and only the bundler
 * enforces it.
 *
 * In the shape of `ad-pacer/constants.ts`.
 * Channels are string KEYS, never numeric ids: oz-reports scattered
 * `$GOOGLE = 2; $FACEBOOK = 1; $YOUTUBE = 6` through its calc code and every
 * reader had to know the mapping. Nothing here or downstream may hardcode a
 * channel — look it up.
 */

export type PacerPlatform = 'meta' | 'google';

export type BudgetChannelCategory =
  | 'Digital'
  | 'Traditional'
  | 'Production'
  | 'Services'
  | 'Fees'
  | 'Other';

export interface BudgetChannel {
  key: string;
  label: string;
  /** Display grouping in the hub — purely presentational. */
  category: BudgetChannelCategory;
  /** Oz Reports channel_id(s) this maps from. Empty = Loomi-only. */
  ozIds: number[];
  /**
   * Ad Pacer platform this channel's budget rolls into, when any. Both
   * `google` and `youtube` map to the Google pacer: the pacer's grain is the
   * Google campaign, and YouTube/Demand Gen campaigns live in the same
   * customer account. Keeping them as separate BUDGET channels preserves the
   * planning split the reps use (Oz channels 2 and 6) without pretending the
   * pacer sees two accounts.
   */
  pacer?: PacerPlatform;
  /** Offered to reps on the Projects intake form. */
  intake?: boolean;
}

export const BUDGET_CHANNELS: readonly BudgetChannel[] = [
  // ── Digital ──
  { key: 'meta', label: 'Meta', category: 'Digital', ozIds: [1], pacer: 'meta', intake: true },
  { key: 'google', label: 'Google', category: 'Digital', ozIds: [2], pacer: 'google', intake: true },
  { key: 'youtube', label: 'YouTube', category: 'Digital', ozIds: [6], pacer: 'google', intake: true },
  { key: 'tiktok', label: 'TikTok', category: 'Digital', ozIds: [3], intake: true },
  { key: 'ksl', label: 'KSL', category: 'Digital', ozIds: [4], intake: true },
  { key: 'seo', label: 'SEO', category: 'Digital', ozIds: [5], intake: true },
  { key: 'email', label: 'Email', category: 'Digital', ozIds: [7], intake: true },
  { key: 'sms', label: 'Text / SMS', category: 'Digital', ozIds: [33], intake: true },
  { key: 'ott', label: 'CTV / OTT', category: 'Digital', ozIds: [9], intake: true },
  { key: 'organic_social', label: 'Organic Social', category: 'Digital', ozIds: [37], intake: true },
  { key: 'conquest', label: 'Conquest', category: 'Digital', ozIds: [39] },

  // ── Traditional ──
  { key: 'tv', label: 'TV', category: 'Traditional', ozIds: [8], intake: true },
  { key: 'radio', label: 'Radio', category: 'Traditional', ozIds: [10], intake: true },
  { key: 'billboard', label: 'Billboard', category: 'Traditional', ozIds: [11], intake: true },
  { key: 'transit_billboard', label: 'Transit Billboard', category: 'Traditional', ozIds: [35], intake: true },
  { key: 'print', label: 'Print / Mailer', category: 'Traditional', ozIds: [43], intake: true },
  { key: 'edd', label: 'EDDM', category: 'Traditional', ozIds: [13], intake: true },

  // ── Production ──
  { key: 'production', label: 'Production', category: 'Production', ozIds: [27], intake: true },

  // ── Services ──
  { key: 'data_feed', label: 'Data Feed', category: 'Services', ozIds: [16] },
  { key: 'lead_provider', label: 'Lead Provider', category: 'Services', ozIds: [19] },
  { key: 'conversion_provider', label: 'Conversion Provider', category: 'Services', ozIds: [18] },
  { key: 'database', label: 'Database', category: 'Services', ozIds: [12] },
  { key: 'reputation', label: 'Reputation Management', category: 'Services', ozIds: [20] },
  { key: 'chat', label: 'Chat', category: 'Services', ozIds: [17] },
  { key: 'development', label: 'Development', category: 'Services', ozIds: [31] },
  { key: 'maintenance', label: 'Maintenance', category: 'Services', ozIds: [32] },
  { key: 'marketing_analytics', label: 'Marketing & Analytics', category: 'Services', ozIds: [44] },

  // ── Fees ──
  // 30 and 40 are both "Management Fee" in Oz Reports — the one real duplicate
  // in the table, collapsed here so the hub doesn't show the same thing twice.
  { key: 'management_fee', label: 'Management Fee', category: 'Fees', ozIds: [30, 40] },
  { key: 'managed_marketing_services', label: 'Managed Marketing Services', category: 'Fees', ozIds: [29] },
  { key: 'contribution', label: 'Contribution', category: 'Fees', ozIds: [28] },

  // ── Other ──
  { key: 'pr', label: 'PR', category: 'Other', ozIds: [41], intake: true },
  { key: 'sponsorship', label: 'Sponsorship', category: 'Other', ozIds: [36], intake: true },
  { key: 'referral', label: 'Referral', category: 'Other', ozIds: [21] },
  { key: 'yag', label: 'YAG', category: 'Other', ozIds: [22] },
  { key: 'group_sale', label: 'Group Sale', category: 'Other', ozIds: [23] },
  { key: 'store_sale', label: 'Store Sale', category: 'Other', ozIds: [24] },
  { key: 'group_event', label: 'Group Event', category: 'Other', ozIds: [25] },
  { key: 'store_event', label: 'Store Event', category: 'Other', ozIds: [26] },
  { key: 'auxiliary', label: 'Auxiliary', category: 'Other', ozIds: [38] },
  { key: 'new_clients', label: 'New Clients', category: 'Other', ozIds: [42] },
  { key: 'other', label: 'Other', category: 'Other', ozIds: [34] },
] as const;

const BY_KEY = new Map(BUDGET_CHANNELS.map((c) => [c.key, c]));

/** Oz Reports channel_id → Loomi channel key. Built once from `ozIds`. */
const BY_OZ_ID = new Map<number, string>();
for (const c of BUDGET_CHANNELS) {
  for (const id of c.ozIds) BY_OZ_ID.set(id, c.key);
}

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
 * Resolve an Oz Reports channel_id during import. Returns null for an id with
 * no mapping (and for 0/null, which Oz allows) so the importer can report it
 * rather than guessing a home for real money.
 */
export function channelFromOzId(ozId: number | null | undefined): string | null {
  if (ozId == null) return null;
  return BY_OZ_ID.get(ozId) ?? null;
}

/**
 * Channels a rep can choose on the intake form. Deliberately a subset: all 44
 * exist so the hub reconciles against Oz Reports, but a ticket is never filed
 * against "Contribution" or "Management Fee".
 */
export const INTAKE_CHANNELS: readonly BudgetChannel[] = BUDGET_CHANNELS.filter((c) => c.intake);

/** Registry order, grouped for the hub's channel pickers. */
export const CHANNEL_CATEGORY_ORDER: BudgetChannelCategory[] = [
  'Digital',
  'Traditional',
  'Production',
  'Services',
  'Fees',
  'Other',
];

/**
 * Task kind (Projects intake) → the channels its budget can land on. Keys are
 * BudgetChannel keys — never invent one here. A kind absent from this map
 * spends no media budget and gets no budget block at intake.
 */
export const KIND_BUDGET_CHANNELS: Record<string, string[]> = {
  ads: ['meta', 'google', 'youtube', 'tiktok', 'ksl'],
  print: ['print', 'edd'],
  email: ['email'],
  sms: ['sms'],
  media_buy: ['radio', 'tv', 'billboard', 'transit_billboard', 'ott'],
  video: ['production'],
  pr: ['pr', 'sponsorship'],
  social: ['organic_social'],
};
