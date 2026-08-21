/**
 * Billing categories (rate cards) — the MARGIN axis.
 *
 * This file used to hold the whole budget taxonomy: a 44-entry
 * `BUDGET_CHANNELS` constant plus synchronous lookups over it. Both are gone.
 * The channel list is data now (`BudgetChannel`, read through
 * services/budget-channels on the server or the budget-channels context on the
 * client) and the lookups live in budget/channel-registry, which operates on
 * whatever list it's handed.
 *
 * The sync lookups were deliberately NOT left behind as a convenience wrapper
 * over the seed: a function that silently answers from a hardcoded list is
 * indistinguishable from a correct one until someone renames a channel, and
 * then it's wrong everywhere at once.
 *
 * What's left here is the rate-card SEED — the categories a fresh install
 * starts with, and the fallback for an empty `BillingCategory` table. Same
 * arrangement as the channels: see services/rate-cards.
 *
 * UNIVERSAL — no 'use client', no server imports. Marking this 'use client'
 * once made every export a client reference that threw the moment a route
 * handler called it, and 988 passing tests didn't catch it because vitest runs
 * plain Node where the directive is inert.
 */

// Re-exported so the many files that ask this module for line types and the
// registry keep one import. The definitions live in channel-registry, which is
// where the rest of the taxonomy went.
export {
  createChannelRegistry,
  isBudgetLineType,
  isPacerPlatform,
  EMPTY_CHANNEL_REGISTRY,
  SEED_INTAKE_KINDS,
  LINE_TYPES,
  LINE_TYPE_LABEL,
  PACER_PLATFORMS,
  SEED_CHANNELS,
  SEED_CHANNEL_RECORDS,
  type BudgetLineType,
  type ChannelRecord,
  type ChannelRegistry,
  type PacerPlatform,
} from '@/lib/budget/channel-registry';

/**
 * How the agency prices a kind of work. This is the MARGIN axis, and it is
 * deliberately separate from a channel's `category`, which is display grouping.
 *
 * They diverge in practice and both are right: KSL shows under Digital in the
 * hub because that's where a rep looks for it, but it bills at the Mass Media
 * rate. Email and SMS show under Digital and bill as Development. Collapsing
 * the two would force one of those to be wrong.
 *
 * SEED ONLY. The live list is the `BillingCategory` table, editable in
 * Settings → Markup; these are the rows a fresh install gets. Nothing at
 * runtime may resolve a rate from here — go through services/rate-cards.
 */
export const BILLING_CATEGORIES: {
  key: string;
  label: string;
  /** Seed gross→spend factor. 0.77 = the agency keeps 23%. */
  defaultMarkup: number;
}[] = [
  { key: 'digital', label: 'Digital', defaultMarkup: 0.77 },
  { key: 'mass_media', label: 'Mass Media', defaultMarkup: 0.85 },
  { key: 'pr', label: 'PR', defaultMarkup: 0.8 },
  { key: 'swag', label: 'Swag', defaultMarkup: 0.7 },
  { key: 'print_event', label: 'Print, Xtreme & Event', defaultMarkup: 0.8 },
  { key: 'production', label: 'Production', defaultMarkup: 0.8 },
  { key: 'development', label: 'Development', defaultMarkup: 0.8 },
];
