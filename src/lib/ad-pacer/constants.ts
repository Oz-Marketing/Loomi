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
 * Solid bg + white text for ad statuses (Monday-style "filled" tags).
 * Other status palettes (DESIGN_STATUS_COLORS, APPROVAL_STATUS_COLORS) keep
 * the translucent treatment — saturation here is reserved for the primary
 * state-of-the-ad signal.
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
  Approved: ['rgba(34,197,94,0.18)', '#4ade80'],
  'Work In Progress': ['rgba(251,146,60,0.18)', '#fb923c'],
  Stuck: ['rgba(239,68,68,0.18)', '#fca5a5'],
  'Revisions Needed': ['rgba(252,211,77,0.18)', '#fcd34d'],
  'Not Started': ['var(--muted)', 'var(--muted-foreground)'],
  'In Proofing/Pending Approval': ['rgba(56,189,248,0.18)', '#7dd3fc'],
  'N/A': ['var(--muted)', 'var(--muted-foreground)'],
};

export const APPROVAL_STATUS_COLORS: Record<string, [string, string]> = {
  Approved: ['rgba(34,197,94,0.18)', '#4ade80'],
  'Pending Approval': ['rgba(245,158,11,0.18)', '#fbbf24'],
  'Does Not Approve': ['rgba(239,68,68,0.18)', '#f87171'],
  'Changes Requested': ['rgba(56,189,248,0.18)', '#7dd3fc'],
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
