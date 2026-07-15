/**
 * Shared constants for the Meta Ad Planner / Ad Pacer pages. Adding a new
 * status or color here makes it show up everywhere — pills, dropdowns,
 * and the status battery legend stay in sync.
 */

export const AD_STATUSES = [
  'Ready- Pending Approval',
  'Live',
  'Stuck',
  'In Draft',
  'Live - Changes Required',
  'Pending Design',
  'Completed Run',
  'Off',
  'Waiting on Rep',
  'Scheduled',
  'Working on it',
  'Budget Adjustment',
];

export const DESIGN_STATUSES = [
  'Work In Progress',
  'Approved',
  'Stuck',
  'Revisions Needed',
  'Not Started',
  'In Proofing/Pending Approval',
  'N/A',
];

export const APPROVAL_STATUSES = [
  'Pending Approval',
  'Approved',
  'Does Not Approve',
  'Changes Requested',
];

export const ACTION_NEEDED = [
  'Extending Ad',
  'Create New',
  'Updating Recurring Ad',
  'Update Existing Ad',
];

export const RECURRING_OPTS = ['Yes', 'No', 'Unknown'];
export const COOP_OPTS = ['Yes', 'No', 'Unknown'];

export const COLORS = {
  daily: '#38bdf8',
  lifetime: '#a78bfa',
  base: '#38bdf8',
  added: '#34d399',
  split: '#f472b6',
  success: '#22c55e',
  warn: '#f59e0b',
  error: '#ef4444',
};

/** 8-color rotation used to identify ads on bars + cards. */
export const AD_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#4ade80',
];

// Markup (the gross→spend factor) is no longer a constant — it is per-account
// (Account.markup) with an admin-configured agency default. Resolve it via
// `accountMarginSetting` in _lib/markup (server reads the default from
// services/markup). §0.1: no hardcoded markup literal anywhere in calc code.

/**
 * A closed month whose |over/under| (actual − spend target) meets this is
 * flagged for carryover into the next month (Change 7). Configurable later;
 * a single agency-wide default for now.
 */
export const CARRYOVER_THRESHOLD = 15;

/**
 * §1 cross-month straddler: flag an ad whose flight crosses a month boundary
 * when its in-month slice is below this fraction of the full-run target (i.e.
 * materially short — a ~12.5% gap, inside the spec's 10–15% band), so a flight
 * that's ~95% within one month doesn't trip the "variance expected" flag.
 */
export const CROSS_MONTH_IN_MONTH_THRESHOLD = 0.875;

/**
 * Solid bg + white text for ad statuses (Monday-style "filled" tags). Design +
 * approval pills use the same solid treatment so all three read as one family.
 */
export const AD_STATUS_COLORS: Record<string, [string, string]> = {
  Live: ['#22c55e', '#ffffff'],
  'Ready- Pending Approval': ['#0ea5e9', '#ffffff'],
  'In Draft': ['#6b7280', '#ffffff'],
  Scheduled: ['#f59e0b', '#ffffff'],
  'Live - Changes Required': ['#a78bfa', '#ffffff'],
  'Pending Design': ['#ec4899', '#ffffff'],
  'Completed Run': ['#16a34a', '#ffffff'],
  Off: ['#14b8a6', '#ffffff'],
  'Waiting on Rep': ['#eab308', '#ffffff'],
  'Working on it': ['#f97316', '#ffffff'],
  Stuck: ['#ef4444', '#ffffff'],
  'Budget Adjustment': ['#06b6d4', '#ffffff'],
};

export const DESIGN_STATUS_COLORS: Record<string, [string, string]> = {
  Approved: ['#22c55e', '#ffffff'],
  'Work In Progress': ['#fb923c', '#ffffff'],
  Stuck: ['#ef4444', '#ffffff'],
  'Revisions Needed': ['#facc15', '#ffffff'],
  'Not Started': ['var(--muted)', 'var(--muted-foreground)'],
  'In Proofing/Pending Approval': ['#0ea5e9', '#ffffff'],
  'N/A': ['var(--muted)', 'var(--muted-foreground)'],
};

export const APPROVAL_STATUS_COLORS: Record<string, [string, string]> = {
  Approved: ['#22c55e', '#ffffff'],
  'Pending Approval': ['#f59e0b', '#ffffff'],
  'Does Not Approve': ['#ef4444', '#ffffff'],
  'Changes Requested': ['#0ea5e9', '#ffffff'],
};

/**
 * Order the StatusBattery renders segments in (worst → best). Adding a new
 * status here also affects ordering in the legend below the bar.
 */
export const STATUS_PRIORITY = [
  'Stuck',
  'Pending Design',
  'Waiting on Rep',
  'Budget Adjustment',
  'In Draft',
  'Working on it',
  'Ready- Pending Approval',
  'Live - Changes Required',
  'Scheduled',
  'Live',
  'Completed Run',
  'Off',
];

/** Which statuses count as "Active" for the quick-view filter chip. */
export const ACTIVE_STATUSES = ['Live', 'Live - Changes Required'];

/**
 * Department whitelist per role-picker — each role's UserPicker pre-filters
 * the directory to people in these departments (with a "Show all users"
 * fallback toggle).
 */
export const USER_DEPT_FILTERS = {
  owner: ['Account Representative', 'Digital'],
  designer: ['Graphic Design'],
  accountRep: ['Account Representative'],
} as const;

/** Activity-log uploads cap at 25 MB to mirror the API limit. */
export const PACER_ACTIVITY_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ─── Pacing-health / recommendation engine tunables ─────────────────────────
// Shared by the Meta and Google recommendation engines (pacing-engine.ts).
// Exposed here rather than hard-coded so the bands can be calibrated against
// real account behavior without touching calc code.

/** Rolling health window (days) for Meta pacing health. */
export const HEALTH_WINDOW_DAYS = 7;
/** Pacing ratio at/above which delivery is "healthy" (spending its budget). */
export const HEALTH_HEALTHY_THRESHOLD = 0.9;
/** Pacing ratio below which delivery is "low" — the delivery-low/limited gate. */
export const HEALTH_LOW_THRESHOLD = 0.75;
/** Below this many fractional days of history the health verdict is withheld —
 *  a few hours of a partial day is exactly the single-day noise the 7-day
 *  window exists to avoid. */
export const HEALTH_MIN_DAYS = 0.5;
/** Base on-track band (± of target). Tightens as the period runs out. */
export const ON_TRACK_TOLERANCE = 0.05;
/** The tightened floor the on-track band never shrinks below near period end. */
export const ON_TRACK_TOLERANCE_FLOOR = 0.02;
/** Largest single budget raise recommended in one move (re-triggers learning
 *  beyond this); also the large-jump flag threshold. */
export const RAISE_STEP_CAP = 0.2;
/** Meta single-day flexibility (overage) bounds: accounts are on either the
 *  25% or 75% rollout, so the empirically derived value is clamped to [.25,.75]. */
export const OVERAGE_ALLOWANCE_MIN = 0.25;
export const OVERAGE_ALLOWANCE_MAX = 0.75;
/** Fallback when neither the spend series nor an account setting reveals the
 *  account's flexibility (newer accounts are on 75%). */
export const OVERAGE_ALLOWANCE_DEFAULT = 0.75;
/** Days of nonzero spend history required before trusting the empirically
 *  derived overage (a young ad may never have run hot enough to reveal it). */
export const OVERAGE_MIN_HISTORY_DAYS = 14;
/** Google: monthly charging limit multiplier (30.4 = 365/12). A Google
 *  constant, not a judgment knob — exposed so a future platform change is a
 *  config edit. */
export const MONTH_DAYS_MULTIPLIER = 30.4;
/** Google: fixed single-day spending limit multiple of the average daily
 *  budget (2× for all accounts — unlike Meta's per-account overage). */
export const GOOGLE_DAILY_MULTIPLIER = 2;
