// §8 — pure Google-specific pacer logic. No API, no DB, no React: channel-group
// mapping, budget-type mapping, the channel rollup, the account daily-set-vs-
// needed roll-up, and import reconciliation. Everything channel-agnostic (the
// per-line pacing math, eligibility, cross-month, over/under) is REUSED from
// pacer-calc — this file only adds what's Google-specific, and is unit-tested
// against mock data so it's correct before the live API is ever connected.

import type { PacerAd } from './types';
import { buildAdCalc, isEligibleForLivePacing, isLifetimeInProgress } from './pacer-calc';

export type GoogleChannelGroup =
  | 'Search'
  | 'Display'
  | 'Video'
  | 'Shopping'
  | 'PMax'
  | 'Other';

/** One campaign as pulled from the Google Ads API, before mapping to a card. */
export interface ImportedGoogleCampaign {
  id: string;
  name: string;
  status: string; // ENABLED | PAUSED | ...
  channelType: string; // raw advertising_channel_type enum
  dailyBudget: number | null; // $ (amount_micros)
  totalBudget: number | null; // $ (total_amount_micros)
  budgetResourceName: string | null;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Map Google's advertising_channel_type enum to the display rollup group.
 * PERFORMANCE_MAX is its OWN group and is never decomposed into Search/Video
 * (§8 — it spends across surfaces the API won't cleanly split). Unknown/!rare
 * types fall to "Other" rather than guessing.
 */
export function mapChannelGroup(channelType: string | null | undefined): GoogleChannelGroup {
  switch ((channelType ?? '').toUpperCase()) {
    case 'SEARCH':
      return 'Search';
    case 'DISPLAY':
      return 'Display';
    case 'VIDEO':
      return 'Video';
    case 'SHOPPING':
      return 'Shopping';
    case 'PERFORMANCE_MAX':
      return 'PMax';
    default:
      return 'Other';
  }
}

/**
 * Google budget type → the Meta budget-type branch the rest of the tool keys off.
 * A total/lifetime budget (total_amount_micros set) maps to 'Lifetime' (§0.2
 * exclusion / §2b split / §3 book-once all apply); an average daily budget maps
 * to 'Daily' (standard per-flight proration, framed as an average).
 */
export function mapGoogleBudgetType(
  _dailyBudget: number | null | undefined,
  totalBudget: number | null | undefined,
): 'Daily' | 'Lifetime' {
  // A set total/lifetime budget = the Meta 'Lifetime' branch; otherwise the
  // average-daily budget = 'Daily'. (dailyBudget is accepted for call-site
  // symmetry — the decision only needs the total.)
  return totalBudget != null && totalBudget > 0 ? 'Lifetime' : 'Daily';
}

export interface ChannelGroupRollup {
  group: GoogleChannelGroup;
  count: number;
  allocation: number; // Σ planned allocation
  actual: number; // Σ actual spend
}

/**
 * Roll Google lines up by channel group for DISPLAY only (§0.4: never the basis
 * for action — the per-campaign rows are). Returns one entry per non-empty group
 * in a stable order. Only Google-platform lines are grouped.
 */
export function groupByChannel(ads: PacerAd[]): ChannelGroupRollup[] {
  const order: GoogleChannelGroup[] = ['Search', 'Display', 'Video', 'Shopping', 'PMax', 'Other'];
  const byGroup = new Map<GoogleChannelGroup, ChannelGroupRollup>();
  for (const ad of ads) {
    if (ad.platform !== 'google') continue;
    const group = mapChannelGroup(ad.googleChannelType);
    const entry =
      byGroup.get(group) ?? { group, count: 0, allocation: 0, actual: 0 };
    entry.count += 1;
    entry.allocation += Number(ad.allocation ?? 0) || 0;
    entry.actual += Number(ad.pacerActual ?? 0) || 0;
    byGroup.set(group, entry);
  }
  return order.filter((g) => byGroup.has(g)).map((g) => byGroup.get(g)!);
}

export interface GoogleDailyRollup {
  dailySet: number; // Σ distinct-budget daily run-rate (lifetime → implied daily)
  dailyNeeded: number; // Σ per-campaign recommended daily to stay on pace
  monthlyCeiling: number; // dailySet × 30.4 — a CEILING/run-rate, NEVER a forecast
  eligibleCount: number;
}

const DAYS_PER_MONTH = 30.4;

/**
 * §8 account daily roll-up: "daily set" vs "daily needed". The gap is the signal
 * (needed ≫ set → will underspend; needed ≪ set → will overspend).
 *
 * Eligibility = §0.2-eligible daily campaigns PLUS in-progress lifetime/total-
 * budget campaigns (those are §0.2-excluded for pacing, but the spec explicitly
 * wants them folded into the daily run-rate as an implied daily). Not-started /
 * completed / unallocated lines are skipped either way.
 *
 * - dailyNeeded: Σ recommended-daily (remaining ÷ days left) per eligible line —
 *   actionable; folds in spend-to-date and days remaining.
 * - dailySet: Σ DISTINCT budgets (dedupe shared campaign budgets via
 *   googleBudgetResourceName) with lifetime converted to total ÷ flight-days.
 * - monthlyCeiling = dailySet × 30.4, labeled a ceiling — Google daily is an
 *   average and demand-limited campaigns won't spend it all, so it's never a
 *   forecast.
 */
export function accountDailyRollup(
  ads: PacerAd[],
  nowMs: number,
  timeZone: string,
): GoogleDailyRollup {
  const seenBudgets = new Set<string>();
  let dailySet = 0;
  let dailyNeeded = 0;
  let eligibleCount = 0;

  for (const ad of ads) {
    if (ad.platform !== 'google') continue;
    const eligible =
      isEligibleForLivePacing(ad, nowMs, timeZone) ||
      isLifetimeInProgress(ad, nowMs, timeZone);
    if (!eligible) continue;
    const c = buildAdCalc(ad, nowMs, timeZone);
    if (c.allocation <= 0) continue; // imported · unallocated — sits out of the roll-up
    eligibleCount += 1;

    // Daily needed: the rec-daily lever for a daily line; for a lifetime line
    // (no daily lever) the implied remaining ÷ days-left.
    const daysLeft = Math.max(0, c.days - c.daysElapsed);
    if (!c.isLifetime && c.recDaily != null) {
      dailyNeeded += c.recDaily;
    } else if (daysLeft > 0) {
      dailyNeeded += Math.max(0, c.allocation - (c.actual ?? 0)) / daysLeft;
    }

    // Daily set: count each distinct budget once (shared budgets dedupe);
    // lifetime → implied daily (total ÷ flight days).
    const budgetKey = ad.googleBudgetResourceName || `__ad:${ad.id}`;
    if (!seenBudgets.has(budgetKey)) {
      seenBudgets.add(budgetKey);
      dailySet += c.isLifetime
        ? c.days > 0
          ? c.allocation / c.days
          : 0
        : c.dailyBudget ?? 0;
    }
  }

  return {
    dailySet,
    dailyNeeded,
    monthlyCeiling: dailySet * DAYS_PER_MONTH,
    eligibleCount,
  };
}

export interface ImportChange {
  adId: string;
  googleCampaignId: string;
  field: 'name' | 'status' | 'budgetType';
  from: string;
  to: string;
}

export interface ImportDiff {
  adds: ImportedGoogleCampaign[]; // campaigns with no linked card yet
  removes: { adId: string; name: string; googleCampaignId: string }[]; // linked card, campaign gone
  changes: ImportChange[]; // matched but name/status/budget changed
}

/**
 * §8 import reconciliation: diff freshly-imported campaigns against the existing
 * linked Google cards, returning adds / removes / changes for the user to
 * CONFIRM. Never auto-overwrites allocations — observed platform data is a
 * suggestion. (A renamed or paused campaign surfaces as a change, not a wipe.)
 */
export function reconcileImport(
  imported: ImportedGoogleCampaign[],
  existing: PacerAd[],
): ImportDiff {
  const linked = existing.filter((a) => a.platform === 'google' && a.googleCampaignId);
  const byCampaign = new Map(linked.map((a) => [a.googleCampaignId as string, a]));
  const importedIds = new Set(imported.map((c) => c.id));

  const adds: ImportedGoogleCampaign[] = [];
  const changes: ImportChange[] = [];
  for (const camp of imported) {
    const existingAd = byCampaign.get(camp.id);
    if (!existingAd) {
      adds.push(camp);
      continue;
    }
    if ((existingAd.name ?? '') !== camp.name) {
      changes.push({
        adId: existingAd.id,
        googleCampaignId: camp.id,
        field: 'name',
        from: existingAd.name ?? '',
        to: camp.name,
      });
    }
    const importedType = mapGoogleBudgetType(camp.dailyBudget, camp.totalBudget);
    if ((existingAd.budgetType ?? 'Daily') !== importedType) {
      changes.push({
        adId: existingAd.id,
        googleCampaignId: camp.id,
        field: 'budgetType',
        from: existingAd.budgetType ?? 'Daily',
        to: importedType,
      });
    }
  }

  const removes = linked
    .filter((a) => !importedIds.has(a.googleCampaignId as string))
    .map((a) => ({
      adId: a.id,
      name: a.name ?? '',
      googleCampaignId: a.googleCampaignId as string,
    }));

  return { adds, removes, changes };
}
