/**
 * The budget channel registry — the spend axis every BudgetLine is placed on.
 *
 * PURE. No database, no 'use client', no server imports. Both sides need the
 * same lookups: the hub and intake render channel labels and icons, the Oz
 * Reports import resolves external ids, and the pacer rollups ask which
 * channels feed a platform. This module knows how to ANSWER those questions
 * about a list of channels; it does not know where the list comes from.
 *
 * That split is the point of phase 2. The list used to be a 44-entry constant
 * here, which made Loomi's budget taxonomy Oz Marketing's — it mirrored Oz
 * Reports' `channels` table down to its numeric ids. The list now lives in the
 * `BudgetChannel` table (services/budget-channels.ts on the server, the
 * budget-channels context on the client) and `SEED_CHANNELS` below is only
 * what a fresh install starts with.
 *
 * WHAT THIS COSTS: `BudgetChannelCategory` used to be a union type and the
 * compiler checked every switch on it. Display groups are now whatever the
 * channels say they are, so that check is gone — hence `categories()`, which
 * derives the real groups in display order rather than trusting a hardcoded
 * list to still be right.
 */

export type PacerPlatform = 'meta' | 'google';

/** The pacer platforms, for validating a channel's `pacer` on write. */
export const PACER_PLATFORMS: PacerPlatform[] = ['meta', 'google'];

export function isPacerPlatform(v: unknown): v is PacerPlatform {
  return typeof v === 'string' && (PACER_PLATFORMS as string[]).includes(v);
}

/**
 * What KIND of money a line is. This is Oz Marketing's P&L made explicit, and
 * it's the dimension Oz Reports never had — media, agency fees, resold vendor
 * services and production all sat in one flat `channel` list, so "how much
 * media do we run" and "what's our margin on this client" were unanswerable
 * without exporting and hand-sorting.
 *
 * Each behaves differently:
 *   media        buys placements from a platform. Costs amount × markup, paces.
 *   fee          agency revenue with no external cost. Nothing to pace.
 *   service      bought wholesale from a vendor and billed on. Real cost, not
 *                a percentage — so it must be entered, never derived.
 *   production   job-costed creative work.
 *   unclassified deliberately unassigned. ~13% of the imported ledger sits in
 *                buckets that don't say what they are ("Other", Sponsorship,
 *                Group Sale, YAG…). Guessing a type for real money is worse
 *                than surfacing it for a human call.
 *
 * STAYS A UNION, unlike the channel list: these five aren't an agency's naming
 * choice, they're the arithmetic. `cost` is derived differently for each (see
 * BudgetLine.cost), so a sixth would be code either way.
 */
export type BudgetLineType = 'media' | 'fee' | 'service' | 'production' | 'unclassified';

/** Display order and labels for the hub's line-type sections. */
export const LINE_TYPES: { key: BudgetLineType; label: string; blurb: string }[] = [
  { key: 'media', label: 'Media', blurb: 'Paid placements — costs amount × markup' },
  { key: 'service', label: 'Services', blurb: 'Resold or retained — enter the vendor cost' },
  { key: 'fee', label: 'Fees', blurb: 'Agency revenue, no external cost' },
  { key: 'production', label: 'Production', blurb: 'Job-costed creative' },
  { key: 'unclassified', label: 'Needs categorizing', blurb: 'No line type assigned yet' },
];

export const LINE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  LINE_TYPES.map((t) => [t.key, t.label]),
);

/** Guard for a value arriving from a request body. */
export function isBudgetLineType(v: unknown): v is BudgetLineType {
  return typeof v === 'string' && LINE_TYPES.some((t) => t.key === v);
}

/** One channel, as the table stores it. */
export interface ChannelRecord {
  key: string;
  label: string;
  /** Display grouping in the hub — purely presentational. */
  category: string;
  /** Default line type for money on this channel. Overridable per line. */
  lineType: BudgetLineType;
  /** Rate card this channel bills at, or null for none of its own. */
  billingKey: string | null;
  /** Ad Pacer platform its budget rolls into, when any. */
  pacer: PacerPlatform | null;
  /**
   * Projects task kinds that may spend on this channel. Empty = offered at
   * intake nowhere. See the note on the column in schema.prisma for why this
   * replaced a plain `intake` boolean.
   */
  intakeKinds: string[];
  /** Lucide icon name; brand marks are resolved in code by key. */
  icon: string | null;
  /** Foreign channel ids this maps from on import (Oz Reports channel_id). */
  externalIds: number[];
  sortOrder: number;
  archived: boolean;
}

/**
 * Lookups over one list of channels.
 *
 * Deliberately an object of small methods rather than free functions reading a
 * module constant: the list is now per-request data, and a free function would
 * have to reach for it globally — which is exactly the coupling that made the
 * taxonomy un-editable in the first place.
 *
 * Every lookup answers for ARCHIVED channels too. A line placed on a channel
 * that was later retired still has to render its label and reconcile; only the
 * pickers filter to active.
 */
export interface ChannelRegistry {
  /** Every channel, archived included, in display order. */
  all: ChannelRecord[];
  /** Active channels only — what a picker should offer. */
  active: ChannelRecord[];
  /** Active channels a rep may choose at intake, on any task kind. */
  intake: ChannelRecord[];
  /**
   * Channel KEYS a task kind may spend on, in display order.
   *
   * The editable form of what `KIND_BUDGET_CHANNELS` hardcoded. Archived
   * channels are excluded: this answers "what may a rep pick", and a retired
   * channel is exactly what may not be picked.
   */
  forKind(kind: string | null | undefined): string[];
  /** True when a task kind has any channel to spend on — i.e. show its budget block. */
  spendsBudget(kind: string | null | undefined): boolean;
  get(key: string | null | undefined): ChannelRecord | null;
  has(key: string | null | undefined): boolean;
  /** Display label, or "Unassigned" for a null/unknown key. */
  label(key: string | null | undefined): string;
  category(key: string | null | undefined): string | null;
  lineType(key: string | null | undefined): BudgetLineType;
  pacerPlatform(key: string | null | undefined): PacerPlatform | null;
  isPaced(key: string | null | undefined): boolean;
  /** Channel keys feeding one pacer platform — the WHERE-IN for the rollup. */
  forPlatform(platform: PacerPlatform): string[];
  billingCategory(key: string | null | undefined): string | null;
  /** Active channels with no rate card of their own. */
  withoutBilling(): ChannelRecord[];
  /** Resolve a foreign channel id during import; null when unmapped. */
  fromExternalId(id: number | null | undefined): string | null;
  /** Distinct display groups, in the order their channels appear. */
  categories(): string[];
}

export function createChannelRegistry(records: readonly ChannelRecord[]): ChannelRegistry {
  const all = [...records].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  const byKey = new Map(all.map((c) => [c.key, c]));

  // Built once. Two channels claiming the same external id would make the
  // import non-deterministic, so the FIRST in display order wins and the
  // service's write path is what stops the collision being created.
  const byExternalId = new Map<number, string>();
  for (const c of all) {
    for (const id of c.externalIds) {
      if (!byExternalId.has(id)) byExternalId.set(id, c.key);
    }
  }

  const active = all.filter((c) => !c.archived);
  const get = (key: string | null | undefined) => (key ? byKey.get(key) ?? null : null);

  return {
    all,
    active,
    intake: active.filter((c) => c.intakeKinds.length > 0),
    get,
    has: (key) => !!key && byKey.has(key),
    label: (key) => get(key)?.label ?? 'Unassigned',
    category: (key) => get(key)?.category ?? null,
    lineType: (key) => get(key)?.lineType ?? 'unclassified',
    pacerPlatform: (key) => get(key)?.pacer ?? null,
    isPaced: (key) => get(key)?.pacer != null,
    forPlatform: (platform) => all.filter((c) => c.pacer === platform).map((c) => c.key),
    billingCategory: (key) => get(key)?.billingKey ?? null,
    withoutBilling: () => active.filter((c) => !c.billingKey),
    fromExternalId: (id) => (id == null ? null : byExternalId.get(id) ?? null),
    forKind: (kind) => (kind ? active.filter((c) => c.intakeKinds.includes(kind)).map((c) => c.key) : []),
    spendsBudget: (kind) => !!kind && active.some((c) => c.intakeKinds.includes(kind)),
    categories: () => [...new Set(active.map((c) => c.category))],
  };
}

/** The shape a `BudgetChannel` row arrives in, from any Prisma client. */
export interface ChannelRow {
  key: string;
  label: string;
  category: string;
  lineType: string;
  billingKey: string | null;
  pacer: string | null;
  intakeKinds: string[];
  icon: string | null;
  externalIds: number[];
  sortOrder: number;
  archivedAt: Date | null;
}

/**
 * One table row as a record.
 *
 * `lineType` and `pacer` are validated on write, so a bad value here means the
 * row was edited outside the app. Coerce rather than throw: one hand-written
 * row shouldn't take down every budget screen.
 *
 * Lives in this pure module, not the service, so the build-time backfill
 * scripts — which construct their own PrismaClient and can't import
 * `@/lib/prisma` — read the table exactly the way the app does.
 */
export function channelRecordFromRow(row: ChannelRow): ChannelRecord {
  return {
    key: row.key,
    label: row.label,
    category: row.category,
    lineType: isBudgetLineType(row.lineType) ? row.lineType : 'unclassified',
    billingKey: row.billingKey,
    pacer: isPacerPlatform(row.pacer) ? row.pacer : null,
    intakeKinds: row.intakeKinds,
    icon: row.icon,
    externalIds: row.externalIds,
    sortOrder: row.sortOrder,
    archived: row.archivedAt != null,
  };
}

/**
 * Build a registry from raw rows, falling back to the seed when there are none.
 * The empty-table case is a fresh database or the window before the seed script
 * runs; an empty registry would reject every channel key as unknown, which
 * looks exactly like data corruption.
 */
export function registryFromRows(rows: ChannelRow[]): ChannelRegistry {
  if (rows.length === 0) return createChannelRegistry(SEED_CHANNEL_RECORDS);
  return createChannelRegistry(rows.map(channelRecordFromRow));
}

/** An empty registry — what a client holds before the fetch resolves. */
export const EMPTY_CHANNEL_REGISTRY = createChannelRegistry([]);

/**
 * Task kind → the channels its budget could land on, as of the move to the
 * table.
 *
 * SEED ONLY, inverted onto `BudgetChannel.intakeKinds` by
 * scripts/seed-budget-channels.ts. Nothing at runtime reads this — ask the
 * registry (`forKind`), which answers from the table. Change what a task kind
 * can spend on in Agency Settings → Channels, not here.
 */
export const SEED_INTAKE_KINDS: Record<string, string[]> = {
  ads: ['meta', 'google', 'youtube', 'tiktok', 'ksl'],
  print: ['print', 'edd'],
  email: ['email'],
  sms: ['sms'],
  media_buy: ['radio', 'tv', 'billboard', 'transit_billboard', 'ott'],
  video: ['production'],
  pr: ['pr', 'sponsorship'],
  social: ['organic_social'],
};

/**
 * What a fresh install starts with: Oz Marketing's channels as of the move to
 * the table, `externalIds` being the Oz Reports channel_id(s) each maps from.
 *
 * SEED ONLY. Nothing at runtime may read this — it exists for
 * scripts/seed-budget-channels.ts and as the fallback for an empty table. Add a
 * channel in Settings, not here.
 */
export const SEED_CHANNELS: readonly Omit<ChannelRecord, 'sortOrder' | 'archived'>[] = [
  // ── Digital ──
  { key: 'meta', label: 'Meta', category: 'Digital', externalIds: [1], pacer: 'meta', intakeKinds: ['ads'], lineType: 'media', billingKey: 'digital', icon: null },
  { key: 'google', label: 'Google', category: 'Digital', externalIds: [2], pacer: 'google', intakeKinds: ['ads'], lineType: 'media', billingKey: 'digital', icon: null },
  // YouTube pacer is 'google' on purpose: the pacer's grain is the Google
  // campaign, and YouTube/Demand Gen campaigns live in the same customer
  // account. Separate BUDGET channels preserve the planning split the reps use.
  { key: 'youtube', label: 'YouTube', category: 'Digital', externalIds: [6], pacer: 'google', intakeKinds: ['ads'], lineType: 'media', billingKey: 'digital', icon: null },
  { key: 'tiktok', label: 'TikTok', category: 'Digital', externalIds: [3], pacer: null, intakeKinds: ['ads'], lineType: 'media', billingKey: null, icon: 'music-2' },
  { key: 'ksl', label: 'KSL', category: 'Digital', externalIds: [4], pacer: null, intakeKinds: ['ads'], lineType: 'media', billingKey: 'mass_media', icon: 'newspaper' },
  { key: 'seo', label: 'SEO', category: 'Digital', externalIds: [5], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'search' },
  { key: 'email', label: 'Email', category: 'Digital', externalIds: [7], pacer: null, intakeKinds: ['email'], lineType: 'service', billingKey: 'development', icon: 'mail' },
  { key: 'sms', label: 'Text / SMS', category: 'Digital', externalIds: [33], pacer: null, intakeKinds: ['sms'], lineType: 'service', billingKey: 'development', icon: 'message-square' },
  { key: 'ott', label: 'CTV / OTT', category: 'Digital', externalIds: [9], pacer: null, intakeKinds: ['media_buy'], lineType: 'media', billingKey: 'digital', icon: 'tv' },
  { key: 'organic_social', label: 'Organic Social', category: 'Digital', externalIds: [37], pacer: null, intakeKinds: ['social'], lineType: 'service', billingKey: null, icon: 'hash' },
  { key: 'conquest', label: 'Conquest', category: 'Digital', externalIds: [39], pacer: null, intakeKinds: [], lineType: 'media', billingKey: null, icon: 'crosshair' },

  // ── Traditional ──
  { key: 'tv', label: 'TV', category: 'Traditional', externalIds: [8], pacer: null, intakeKinds: ['media_buy'], lineType: 'media', billingKey: 'mass_media', icon: 'tv' },
  { key: 'radio', label: 'Radio', category: 'Traditional', externalIds: [10], pacer: null, intakeKinds: ['media_buy'], lineType: 'media', billingKey: 'mass_media', icon: 'radio' },
  { key: 'billboard', label: 'Billboard', category: 'Traditional', externalIds: [11], pacer: null, intakeKinds: ['media_buy'], lineType: 'media', billingKey: 'mass_media', icon: 'rectangle-horizontal' },
  { key: 'transit_billboard', label: 'Transit Billboard', category: 'Traditional', externalIds: [35], pacer: null, intakeKinds: ['media_buy'], lineType: 'media', billingKey: null, icon: 'bus' },
  { key: 'print', label: 'Print / Mailer', category: 'Traditional', externalIds: [43], pacer: null, intakeKinds: ['print'], lineType: 'media', billingKey: 'print_event', icon: 'printer' },
  { key: 'edd', label: 'EDDM', category: 'Traditional', externalIds: [13], pacer: null, intakeKinds: ['print'], lineType: 'media', billingKey: null, icon: 'mailbox' },

  // ── Production ──
  { key: 'production', label: 'Production', category: 'Production', externalIds: [27], pacer: null, intakeKinds: ['video'], lineType: 'production', billingKey: 'production', icon: 'video' },

  // ── Services ──
  { key: 'data_feed', label: 'Data Feed', category: 'Services', externalIds: [16], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'database' },
  { key: 'lead_provider', label: 'Lead Provider', category: 'Services', externalIds: [19], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'user-plus' },
  { key: 'conversion_provider', label: 'Conversion Provider', category: 'Services', externalIds: [18], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'chart-bar' },
  { key: 'database', label: 'Database', category: 'Services', externalIds: [12], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'database' },
  { key: 'reputation', label: 'Reputation Management', category: 'Services', externalIds: [20], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'star' },
  { key: 'chat', label: 'Chat', category: 'Services', externalIds: [17], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'message-circle' },
  { key: 'development', label: 'Development', category: 'Services', externalIds: [31], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'development', icon: 'code' },
  { key: 'maintenance', label: 'Maintenance', category: 'Services', externalIds: [32], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'wrench' },
  { key: 'marketing_analytics', label: 'Marketing & Analytics', category: 'Services', externalIds: [44], pacer: null, intakeKinds: [], lineType: 'service', billingKey: null, icon: 'chart-bar' },

  // ── Fees ──
  // 30 and 40 are both "Management Fee" in Oz Reports — the one real duplicate
  // in that table, collapsed here so the hub doesn't show the same thing twice.
  { key: 'management_fee', label: 'Management Fee', category: 'Fees', externalIds: [30, 40], pacer: null, intakeKinds: [], lineType: 'fee', billingKey: null, icon: 'banknote' },
  { key: 'managed_marketing_services', label: 'Managed Marketing Services', category: 'Fees', externalIds: [29], pacer: null, intakeKinds: [], lineType: 'fee', billingKey: null, icon: 'banknote' },
  { key: 'contribution', label: 'Contribution', category: 'Fees', externalIds: [28], pacer: null, intakeKinds: [], lineType: 'fee', billingKey: null, icon: 'banknote' },

  // ── Other ──
  { key: 'pr', label: 'PR', category: 'Other', externalIds: [41], pacer: null, intakeKinds: ['pr'], lineType: 'service', billingKey: 'pr', icon: 'megaphone' },
  { key: 'sponsorship', label: 'Sponsorship', category: 'Other', externalIds: [36], pacer: null, intakeKinds: ['pr'], lineType: 'unclassified', billingKey: null, icon: 'trophy' },
  { key: 'referral', label: 'Referral', category: 'Other', externalIds: [21], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: 'user-plus' },
  { key: 'yag', label: 'YAG', category: 'Other', externalIds: [22], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'group_sale', label: 'Group Sale', category: 'Other', externalIds: [23], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'store_sale', label: 'Store Sale', category: 'Other', externalIds: [24], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'group_event', label: 'Group Event', category: 'Other', externalIds: [25], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'store_event', label: 'Store Event', category: 'Other', externalIds: [26], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'auxiliary', label: 'Auxiliary', category: 'Other', externalIds: [38], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'new_clients', label: 'New Clients', category: 'Other', externalIds: [42], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },
  { key: 'other', label: 'Other', category: 'Other', externalIds: [34], pacer: null, intakeKinds: [], lineType: 'unclassified', billingKey: null, icon: null },

  // ── Loomi-only channels ──
  // No external ids: line items the agency bills for that Oz Reports never had
  // a channel for, so they could only ever be entered here.
  { key: 'shipping', label: 'Shipping', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'mass_media', icon: null },

  { key: 'dashboard_post', label: 'Dashboard Post', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'media', billingKey: 'pr', icon: 'megaphone' },
  { key: 'brandview_article', label: 'Brandview Article', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'media', billingKey: 'pr', icon: 'newspaper' },
  { key: 'scripts', label: 'Scripts', category: 'Production', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'pr', icon: null },

  { key: 'swag', label: 'Swag', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },
  { key: 'sunglasses', label: 'Sunglasses', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },
  { key: 'shirts', label: 'Shirts', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },
  { key: 'candy', label: 'Candy', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },
  { key: 'toys', label: 'Toys', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },
  { key: 'coozie', label: 'Coozie', category: 'Other', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'swag', icon: null },

  { key: 'flyers', label: 'Flyers', category: 'Traditional', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'print_event', icon: null },
  { key: 'posters', label: 'Posters', category: 'Traditional', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'print_event', icon: null },
  { key: 'postage', label: 'Postage', category: 'Traditional', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'print_event', icon: 'mailbox' },

  { key: 'videos', label: 'Videos', category: 'Production', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'production', icon: 'video' },
  { key: 'content_management', label: 'Content Management', category: 'Production', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'production', icon: null },
  { key: 'editing', label: 'Editing', category: 'Production', externalIds: [], pacer: null, intakeKinds: [], lineType: 'production', billingKey: 'production', icon: null },

  { key: 'landing_page', label: 'Landing Page', category: 'Digital', externalIds: [], pacer: null, intakeKinds: [], lineType: 'service', billingKey: 'development', icon: 'layout' },
];

/** The seed as full records, for an empty-table fallback. */
export const SEED_CHANNEL_RECORDS: readonly ChannelRecord[] = SEED_CHANNELS.map((c, i) => ({
  ...c,
  sortOrder: i,
  archived: false,
}));
