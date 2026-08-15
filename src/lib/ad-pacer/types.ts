/**
 * Shared types for the Meta Ad Planner / Ad Pacer pages. Pure data — no
 * React, no DOM. Server routes use parallel `IncomingAd` shapes; this file
 * is the client-side source of truth.
 */

export interface DirectoryUser {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  accountKeys?: string[];
}

export interface DesignNote {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
}

export interface ActivityEntry {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
  attachmentKey: string | null;
  attachmentFilename: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  attachmentUrl: string | null;
}

export interface PacerAd {
  id: string;
  position: number;
  name: string;
  period: string;
  ownerUserId: string | null;
  designerUserId: string | null;
  accountRepUserId: string | null;
  actionNeeded: string | null;
  recurring: string;
  coop: string;
  budgetType: 'Daily' | 'Lifetime';
  // "split" = allocation is divided between Base and Added pools.
  // `splitBaseAmount` records how much of `allocation` is from Base; the
  // remainder is from Added. pacerActual apportions proportionally.
  budgetSource: 'base' | 'added' | 'split';
  splitBaseAmount: string | null;
  flightStart: string | null;
  flightEnd: string | null;
  liveDate: string | null;
  creativeDueDate: string | null;
  dueDate: string | null;
  dateCompleted: string | null;
  adStatus: string;
  designStatus: string;
  internalApproval: string;
  clientApproval: string;
  allocation: string | null;
  /** Google allocator (§3): the percent-of-payable input, present only while the
   *  card is in percent mode. `allocation` remains the dollar target in both
   *  modes; this exists so the dollar target can be re-derived when the account
   *  payable changes. Null on Meta rows / in dollar mode. */
  allocationPercent?: string | null;
  pacerActual: string | null;
  pacerDailyBudget: string | null;
  pacerTodayDate: string | null;
  pacerEndDate: string | null;
  creativeLink: string | null;
  clientName: string | null;
  digitalDetails: string | null;
  // Facebook (Meta) sync. Server-managed: set by the Sync-from-Facebook job,
  // never edited in the form. `metaObjectId` set = row is linked and its
  // spend is owned by Facebook; `pacerSyncedAt` is an ISO timestamp.
  metaObjectType: string | null;
  metaObjectId: string | null;
  metaEffectiveStatus: string | null;
  pacerSyncedAt: string | null;
  /** Full-run (all-time) spend across the ad set's whole flight; informational. */
  pacerRunSpend: string | null;
  /** Meta's lifetime budget for the ad set (spend cap), synced — the settlement
   *  baseline for a lifetime run (Σ run actual − this). Null for daily ads. */
  metaLifetimeBudget: string | null;
  // §2a/§2b: server-persisted cross-month resolution (survives Meta re-sync).
  // fullRunAppliedToMonth = the YYYY-MM the full run is counted in (single-month
  // straddler). lifetimeMonthSplit = JSON planned per-month split (display-only).
  fullRunAppliedToMonth: string | null;
  lifetimeMonthSplit: string | null;
  /** Cross-month split run: the prior-month ad this instance continues. The
   *  chain settles once at flight end (final month books Σ run actual − the
   *  Meta lifetime budget; earlier months book $0). Null = not linked. */
  linkedPrevAdId: string | null;
  // Actual run schedule from Meta (account-TZ YYYY-MM-DD). Server-managed;
  // the pacer clamps these to the pacing month. metaEndDate null = open-ended.
  metaStartDate: string | null;
  metaEndDate: string | null;
  // §8 Google Ads (optional — present on every row the API returns, but optional
  // here so existing Meta-only constructors don't need updating). platform tags
  // the row ('meta' default / 'google'); the google* fields mirror the meta*
  // ones for a Google-linked campaign line (channel type is the rollup tag).
  platform?: 'meta' | 'google' | null;
  googleCampaignId?: string | null;
  googleChannelType?: string | null;
  googleEffectiveStatus?: string | null;
  googleStartDate?: string | null;
  googleEndDate?: string | null;
  googleBudgetResourceName?: string | null;
  // §2 budget shape: referenceCount > 1 = genuinely SHARED (drives the badge +
  // budget-as-pacing-unit grouping); explicitlyShared = the shareable flag only.
  // budgetPeriod = "DAILY" | "CUSTOM_PERIOD" (the Daily/Total label source).
  googleBudgetReferenceCount?: number | null;
  googleBudgetExplicitlyShared?: boolean | null;
  googleBudgetPeriod?: string | null;
  // §5 delivery signals (opposite remedies — see schema). googleBudgetConstrained
  // = BUDGET_CONSTRAINED (raise budget); googleAdsDisapproved = an ad is
  // disapproved (fix the ads). googlePrimaryStatus = raw campaign.primary_status.
  googlePrimaryStatus?: string | null;
  /** JSON array of campaign.primary_status_reasons — read via parseStatusReasons. */
  googlePrimaryStatusReasons?: string | null;
  googleBudgetConstrained?: boolean | null;
  googleAdsDisapproved?: boolean | null;
  // Delivery-surface metric tiles (§4). Raw INPUTS only — avg CPC, CTR and
  // cost/conv are derived at render from these plus pacerActual, so the tiles
  // can't disagree with the spend figure. Synced on the same month-to-date query
  // as pacerActual; googleMetricsAsOf is that window's last day — the data edge
  // (yesterday live / month end closed). The two impression-share fields are 0–1,
  // null for PMAX / Demand Gen / Display and below Google's reporting threshold.
  googleImpressions?: number | null;
  googleClicks?: number | null;
  googleConversions?: string | null;
  googleConvRate?: string | null;
  googleSearchBudgetLostIs?: string | null;
  googleSearchRankLostIs?: string | null;
  googleMetricsAsOf?: string | null;
  /** §14 — when this campaign's daily was last pushed to Google. Drives the
   *  just-applied marker through Google's 24–48h re-pacing window. */
  googleDailyPushedAt?: string | Date | null;
  // §9 monthly ceiling ($) — server-computed, reprorated across mid-month budget
  // changes (change_event); falls back to current daily × 30.4. Null for total.
  googleProratedCeiling?: string | null;
  // The campaign restricts days/dayparts via an ad schedule (synced). Post
  // June 2026 such campaigns concentrate the monthly cap into active days, so
  // calendar-day pacing math misreads them — badged for now.
  googleHasAdSchedule?: boolean | null;
  /** §6 manual flight override (YYYY-MM-DD) for the funding window when it
   *  differs from Google's literal campaign dates. Re-clamped to the month in
   *  view, so a stale value from another month clamps away. */
  googleFlightStartOverride?: string | null;
  googleFlightEndOverride?: string | null;
  /** §4 locked carve-out: skipped by Balance and by Move (both source and
   *  destination). Changes no numbers on its own. */
  pacerLocked?: boolean | null;
  /** §12 Reserved: committed budget that cannot spend yet. Counts in allocation,
   *  removed from every pacing figure, from Balance/Move/push, from the alert
   *  scanners and from month-end variance. Manual only — never inferred. */
  pacerReserved?: boolean | null;
  /** §9 labels, JSON array of strings. Independent of budgetSource. Shared with
   *  Meta — read/written via lib/ad-pacer/labels.ts, never parsed inline. */
  pacerTags?: string | null;
  // Rolling-window slice of the synced per-day spend for this ad's linked
  // platform object (server-attached, last ~8 days). Feeds the pacing-health
  // engine's rolling 7-day window + the today-so-far readout. Empty until the
  // first series sync.
  dailySpend?: { date: string; spend: number; dailyBudget: number | null }[];
  // Per-ad alert mute (Change 9): silences pacing-family alerts for this ad.
  alertsMuted: boolean;
  designNotes: DesignNote[];
  activityLog: ActivityEntry[];
}

export interface PriorOverUnder {
  period: string;
  clientBudget: number;
  /** The month's spend target with any RESERVED allocations removed (§12). */
  spendTarget: number;
  /** Σ reserved allocations excluded from spendTarget — surfaced, never silent,
   *  so a shrunken target is explainable rather than mysterious. */
  reservedExcluded: number;
  actual: number;
  variance: number; // actual − spendTarget (negative = underspent)
  carryover: number; // −variance: +ve = spend this much more next month
  exceedsThreshold: boolean;
}

export interface PacerPlan {
  accountKey: string;
  period: string;
  baseBudgetGoal: string | null;
  addedBudgetGoal: string | null;
  // The goal pair above is owned by the BudgetLine ledger for this month
  // (docs/budget-module.md §4): the inputs render read-only and the values are
  // written by syncPeriodBudgetFromLines. Per-platform and per-period — a
  // specialist can unmanage a single month to take manual control back.
  budgetManaged: boolean;
  // Per-account markup override (Account.markup). `null` → use the
  // platform default (the admin-configured agency markup). Drives the
  // gross↔actual conversion in the Budget Calculator's Client Budget mode.
  markup: number | null;
  // Resolved IANA zone for pacing math (Meta ad-account zone → stored zone →
  // DEFAULT_TIME_ZONE). Always present; the server resolves it.
  timeZone: string;
  // Per-account Meta single-day budget flexibility (0.25–0.75) for the
  // recommendation engine's shortfall boundary. Server-derived from the spend
  // series (else the account setting, else the default).
  overageAllowance?: number;
  // Live-vs-frozen month model. A frozen month is a closed-month immutable
  // snapshot: read-only, no autosave/sync until an admin reopens. `reopened` =
  // a closed month unlocked for correction (snapshot preserved) until re-frozen.
  frozen: boolean;
  frozenAt: string | null;
  reopened: boolean;
  // Carryover applied to each bucket's derived spend target (actual-spend $).
  // null = none. Never affects the typed budget goal.
  baseCarryover: string | null;
  addedCarryover: string | null;
  // Prior month's settled over/under for the carryover prompt. null when the
  // prior month isn't closed yet or this month is frozen.
  priorOverUnder: PriorOverUnder | null;
  /** Google allocator (§3): the unit the whole card allocates in. Google plans
   *  only; absent/null on Meta. */
  allocationMode?: 'pct' | 'amt' | null;
  /** Google allocator (§9): intended budget per label, for the filtered-view
   *  match check. Never the account denominator. */
  eventBudgets?: Record<string, number> | null;
  ads: PacerAd[];
  // Same-title rows' planned (allocation) + in-month actual across every period,
  // keyed by ad name → period — lets a lifetime ad render its real cross-month
  // split. Only names present in 2+ periods are included.
  siblingsByName?: Record<string, Record<string, { allocation: number; actual: number }>>;
}

export interface PeriodSummary {
  period: string;
  adCount: number;
}

export type PacingStatus = 'on-track' | 'overpacing' | 'underpacing' | 'no-data';

export type PacerInnerTab = 'pacer' | 'summary' | 'compare';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
