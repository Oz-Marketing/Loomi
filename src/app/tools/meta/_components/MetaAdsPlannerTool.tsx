'use client';

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  PlusIcon,
  XMarkIcon,
  AdjustmentsHorizontalIcon,
  TableCellsIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CalendarIcon,
  UserCircleIcon,
  PaintBrushIcon,
  CheckBadgeIcon,
  ChatBubbleOvalLeftIcon,
  TrashIcon,
  FunnelIcon,
  ArrowPathIcon,
  PaperClipIcon,
  PhotoIcon,
  DocumentIcon,
  DocumentDuplicateIcon,
  ArrowTopRightOnSquareIcon,
  PencilSquareIcon,
  CheckIcon,
  CalculatorIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
  LockClosedIcon,
  BoltIcon,
  CheckCircleIcon,
  MinusCircleIcon,
} from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { AccountAvatar } from '@/components/account-avatar';
import { UserAvatar } from '@/components/user-avatar';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { BellIcon, BellOffIcon } from '@/components/icons/bell';
import { InvestmentIcon } from '@/components/icons/investment';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import BulkActionDock from '@/components/bulk-action-dock';
import {
  DatePicker,
  toIso as datePickerToIso,
  type DatePreset,
} from '@/components/ui/date-picker';
import { DEFAULT_TIME_ZONE } from '@/lib/timezone';
import { CARRYOVER_THRESHOLD } from '../_lib/constants';
import {
  buildAdCalc,
  buildPacerCalc,
  isLifetimeInProgress,
  effectiveActual,
  effectiveTarget,
} from '../_lib/pacer-calc';
import { effectiveSpendTarget } from '../_lib/markup';

// ─── Constants ─────────────────────────────────────────────────────────────
const AD_STATUSES = [
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
const DESIGN_STATUSES = [
  'Work In Progress',
  'Approved',
  'Stuck',
  'Revisions Needed',
  'Not Started',
  'In Proofing/Pending Approval',
  'N/A',
];
const APPROVAL_STATUSES = [
  'Pending Approval',
  'Approved',
  'Does Not Approve',
  'Changes Requested',
];
const ACTION_NEEDED = [
  'Extending Ad',
  'Create New',
  'Updating Recurring Ad',
  'Update Existing Ad',
];
const RECURRING_OPTS = ['Yes', 'No', 'Unknown'];
const COOP_OPTS = ['Yes', 'No', 'Unknown'];

const COLORS = {
  daily: '#38bdf8',
  lifetime: '#a78bfa',
  base: '#38bdf8',
  added: '#34d399',
  split: '#f472b6',
  success: '#22c55e',
  warn: '#f59e0b',
  error: '#ef4444',
};

/**
 * Bare fractional-days number for display — 2 decimals so a partial first/last
 * day is visible (and the recommended-daily / projected math reconciles on
 * screen), with trailing zeros trimmed so clean days stay tidy: 1.0183 →
 * "1.02", 2 → "2", 2.5 → "2.5". The math itself keeps full precision
 * (PacerCalc.daysLeft); we only round for display, never re-sum the rounded value.
 */
function fmtDaysNum(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0$/, '');
}

/**
 * Fractional days-remaining with a unit, e.g. "1.02 days" / "2 days". Because
 * a near-whole day like 1.02 no longer collapses to a misleading "1 day", the
 * "remaining ÷ days = recommended daily" relationship is visible to the user.
 */
function fmtDaysLeft(days: number): string {
  return `${fmtDaysNum(days)} day${Math.round(days * 100) / 100 === 1 ? '' : 's'}`;
}

/**
 * Higher-precision day count for the Rec. Daily "basis" line that shows *why*
 * the recommendation is what it is. Normal values read at 2 decimals ("5.34"),
 * but a value a hair over a whole day — e.g. 1.0032, which 2 decimals would
 * hide as "1.00" and the headline shows as a flat "1 day" — bumps to 4
 * decimals so `remaining ÷ days` visibly reconciles with the shown number.
 * Trailing zeros trimmed.
 */
function fmtDaysBasis(days: number): string {
  const r2 = Math.round(days * 100) / 100;
  const decimals = Number.isInteger(r2) && !Number.isInteger(days) ? 4 : 2;
  return days.toFixed(decimals).replace(/\.?0+$/, '');
}

/** "1.0032 days" / "1 day" — the divisor phrase for the Rec. Daily basis. */
function fmtDaysBasisPhrase(days: number): string {
  const n = fmtDaysBasis(days);
  return `${n} day${n === '1' ? '' : 's'}`;
}

// Pacer row health classification — used by both the compact summary
// row and the expanded card to color the left accent stripe + the
// inline pacing badge. Keeps the buckets in one place so the badge
// label and color always agree with the stripe.
type PacerHealth =
  | 'over-budget'
  | 'overpacing'
  | 'underpacing'
  | 'on-track'
  | 'stopped'
  | 'no-data';

interface PacerHealthInfo {
  state: PacerHealth;
  color: string;
  label: string;
  short: string; // 1-2 word tag for compact pills
}

function classifyPacerHealth(
  ad: { adStatus: string; budgetType: 'Daily' | 'Lifetime' },
  calc: {
    budget: number;
    spent: number;
    projected: number;
    hasDates: boolean;
    endsBeforeToday: boolean;
    lifetimePacingPct: number | null;
  },
): PacerHealthInfo {
  if (ad.adStatus === 'Off' || ad.adStatus === 'Completed Run') {
    return {
      state: 'stopped',
      color: 'var(--border)',
      label: 'Stopped',
      short: 'Off',
    };
  }
  if (calc.budget <= 0 || !calc.hasDates) {
    return {
      state: 'no-data',
      color: 'var(--border)',
      label: 'No pacing data',
      short: 'No data',
    };
  }
  if (calc.spent > calc.budget) {
    return {
      state: 'over-budget',
      color: '#ef4444',
      label: 'Over budget',
      short: 'Over',
    };
  }
  const isLifetime = ad.budgetType === 'Lifetime';
  const pct = isLifetime
    ? calc.lifetimePacingPct
    : calc.projected > 0 && calc.budget > 0
      ? (calc.projected / calc.budget) * 100
      : null;
  if (pct == null) {
    return {
      state: 'no-data',
      color: 'var(--border)',
      label: 'No pacing data',
      short: 'No data',
    };
  }
  if (pct > 105) {
    return {
      state: 'overpacing',
      color: '#f59e0b',
      label: 'Overpacing',
      short: 'Overpacing',
    };
  }
  if (pct < 95) {
    return {
      state: 'underpacing',
      color: '#38bdf8',
      label: 'Underpacing',
      short: 'Under',
    };
  }
  return {
    state: 'on-track',
    color: '#22c55e',
    label: 'On track',
    short: 'On track',
  };
}

const AD_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#4ade80',
];

// §0.1: the client never holds a markup literal. The server resolves the
// per-account factor (Account.markup override, else the agency default) and
// sends it on the plan / period / overview payloads; this just normalizes a
// possibly-missing value, guarding it to 0 so an unconfigured markup surfaces
// as $0 rather than a plausible-but-wrong number.
const effMarkupOf = (markup: number | null | undefined): number =>
  typeof markup === 'number' && Number.isFinite(markup) && markup > 0 ? markup : 0;

// Per-ad contribution to the Base / Added budget pools. For a regular
// single-source ad, the full allocation + pacerActual goes to its source.
// For a "split" ad, the allocation is divided per `splitBaseAmount` and
// the pacerActual is apportioned proportionally — keeping both pools'
// over/under math accurate when one ad is funded from both budgets.
interface AdSourceContribution {
  baseAllocation: number;
  addedAllocation: number;
  baseSpent: number;
  addedSpent: number;
}

function adContribution(ad: {
  allocation?: string | null;
  pacerActual?: string | null;
  budgetSource: 'base' | 'added' | 'split';
  splitBaseAmount: string | null;
}): AdSourceContribution {
  const allocation = numUtil(ad.allocation) ?? 0;
  const spent = numUtil(ad.pacerActual) ?? 0;
  if (ad.budgetSource === 'split' && allocation > 0) {
    const baseAlloc = Math.min(
      Math.max(0, numUtil(ad.splitBaseAmount) ?? 0),
      allocation,
    );
    const baseShare = baseAlloc / allocation;
    return {
      baseAllocation: baseAlloc,
      addedAllocation: allocation - baseAlloc,
      baseSpent: spent * baseShare,
      addedSpent: spent * (1 - baseShare),
    };
  }
  if (ad.budgetSource === 'added') {
    return {
      baseAllocation: 0,
      addedAllocation: allocation,
      baseSpent: 0,
      addedSpent: spent,
    };
  }
  return {
    baseAllocation: allocation,
    addedAllocation: 0,
    baseSpent: spent,
    addedSpent: 0,
  };
}

// Lightweight number-parse helper used by adContribution before the
// shared `num` import is in scope at this position. Mirrors the same
// behavior — returns null on empty/non-numeric, number otherwise.
function numUtil(s: string | null | undefined): number | null {
  if (s == null) return null;
  const trimmed = String(s).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Display helpers for the three budget sources (Base / Added / Split).
// Centralized so adding a new source later only touches one place, and
// so the Split tint stays consistent with the lifetime/violet accent
// used in the ad editor.
function sourceLabel(s: 'base' | 'added' | 'split'): string {
  return s === 'base' ? 'Base' : s === 'added' ? 'Added' : 'Split';
}
function sourceColor(s: 'base' | 'added' | 'split'): string {
  return s === 'base'
    ? COLORS.base
    : s === 'added'
      ? COLORS.added
      : COLORS.split;
}
function sourceTint(s: 'base' | 'added' | 'split'): string {
  return s === 'base'
    ? 'rgba(56,189,248,0.18)'
    : s === 'added'
      ? 'rgba(52,211,153,0.18)'
      : 'rgba(244,114,182,0.22)';
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface DirectoryUser {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  accountKeys?: string[];
}
interface DesignNote {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
}
interface ActivityEntry {
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
interface PacerAd {
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
  budgetSource: 'base' | 'added' | 'split';
  // When budgetSource === 'split', this is the dollar portion of
  // `allocation` drawn from the Base pool. The Added portion is the
  // remainder (allocation − splitBaseAmount). pacerActual apportions
  // proportionally so both pools' over/under math stays accurate.
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
  pacerActual: string | null;
  pacerDailyBudget: string | null;
  pacerTodayDate: string | null;
  pacerEndDate: string | null;
  creativeLink: string | null;
  clientName: string | null;
  digitalDetails: string | null;
  // Facebook (Meta) sync — server-managed, mirror of _lib/types.ts PacerAd.
  metaObjectType: string | null;
  metaObjectId: string | null;
  metaEffectiveStatus: string | null;
  pacerSyncedAt: string | null;
  /** Full-run (all-time) spend across the ad set's whole flight; informational. */
  pacerRunSpend: string | null;
  // §2a/§2b cross-month resolution (server-managed, survives sync) — mirror of
  // _lib/types.ts PacerAd.
  fullRunAppliedToMonth: string | null;
  lifetimeMonthSplit: string | null;
  metaStartDate: string | null;
  metaEndDate: string | null;
  alertsMuted: boolean;
  designNotes: DesignNote[];
  activityLog: ActivityEntry[];
}
interface PacerPlan {
  accountKey: string;
  period: string;
  baseBudgetGoal: string | null;
  addedBudgetGoal: string | null;
  // Per-account markup override (Account.markup). `null` → use the
  // the agency default markup. Drives the Budget Calculator's Client Budget
  // mode (gross × markup = actual spend).
  markup: number | null;
  // Resolved IANA zone for pacing math (Meta ad-account zone → valid stored
  // zone → DEFAULT_TIME_ZONE). Always present; the server resolves it.
  timeZone: string;
  // Live-vs-frozen month model (Change 5). A frozen month is a closed-month
  // immutable snapshot: read-only, no autosave, no sync until an admin reopens.
  // `reopened` = a closed month an admin unlocked for correction (editable
  // again, with the original snapshot preserved) until it's re-frozen.
  frozen: boolean;
  frozenAt: string | null;
  reopened: boolean;
  // Carryover applied to each bucket's derived spend target (Change 7), in
  // actual-spend dollars. null = none. Never affects the typed budget goal.
  baseCarryover: string | null;
  addedCarryover: string | null;
  // The prior month's settled over/under, for the carryover prompt. null when
  // the prior month isn't closed yet or this month is frozen.
  priorOverUnder: PriorOverUnder | null;
  ads: PacerAd[];
}

interface PriorOverUnder {
  period: string;
  clientBudget: number;
  spendTarget: number;
  actual: number;
  variance: number; // actual − spendTarget (negative = underspent)
  carryover: number; // −variance: +ve = spend this much more next month
  exceedsThreshold: boolean;
}
interface PeriodSummary {
  period: string;
  adCount: number;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = (val: number | string | null | undefined): string => {
  const n = Number(val ?? 0);
  if (isNaN(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};
/** Reformat a YYYY-MM-DD ISO date into the user-facing MM-DD-YYYY layout. */
const fmtFullDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${m}-${day}-${y}`;
};
const calcDays = (start: string | null, end: string | null): number => {
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1,
  );
};
/** Subtract N business days (Mon–Fri only) from a YYYY-MM-DD date string. */
function subtractBusinessDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function autoDueDateFromFlightStart(flightStart: string | null): string | null {
  if (!flightStart) return null;
  return subtractBusinessDays(flightStart, 2);
}

/**
 * Classify the urgency of an ad's overall due date.
 * Returns null when there's nothing actionable to surface (no due date, or the
 * ad is already live/completed/off so the due date is moot).
 */
type DueDateUrgency = {
  label: string;
  level: 'overdue' | 'today' | 'soon' | 'upcoming';
};
const DUE_DATE_DONE_STATUSES = new Set(['Live', 'Completed Run', 'Off']);
function classifyDueDate(ad: PacerAd): DueDateUrgency | null {
  if (!ad.dueDate) return null;
  if (DUE_DATE_DONE_STATUSES.has(ad.adStatus)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(ad.dueDate + 'T00:00:00');
  const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0)
    return { label: `Overdue ${Math.abs(diff)}d`, level: 'overdue' };
  if (diff === 0) return { label: 'Due today', level: 'today' };
  if (diff <= 2) return { label: `Due in ${diff}d`, level: 'soon' };
  if (diff <= 7) return { label: `Due in ${diff}d`, level: 'upcoming' };
  return null;
}
const DUE_DATE_CHIP_STYLES: Record<DueDateUrgency['level'], { bg: string; color: string }> = {
  overdue: { bg: 'rgba(239,68,68,0.18)', color: '#fca5a5' },
  today: { bg: 'rgba(252,211,77,0.22)', color: '#fcd34d' },
  soon: { bg: 'rgba(252,211,77,0.18)', color: '#fcd34d' },
  upcoming: { bg: 'rgba(190,242,100,0.18)', color: '#bef264' },
};
function DueDateChip({ ad }: { ad: PacerAd }) {
  const urgency = classifyDueDate(ad);
  if (!urgency) return null;
  const { bg, color } = DUE_DATE_CHIP_STYLES[urgency.level];
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {urgency.level === 'overdue' || urgency.level === 'today' ? (
        <ExclamationTriangleIcon className="w-3 h-3" />
      ) : (
        <ClockIcon className="w-3 h-3" />
      )}
      {urgency.label}
    </span>
  );
}
const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const newAdId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp_${Math.random().toString(36).slice(2)}`;

function makeAd(position: number, period: string): PacerAd {
  return {
    id: newAdId(),
    position,
    name: '',
    period,
    ownerUserId: null,
    designerUserId: null,
    accountRepUserId: null,
    actionNeeded: null,
    recurring: 'No',
    coop: 'No',
    budgetType: 'Daily',
    budgetSource: 'base',
    splitBaseAmount: null,
    flightStart: null,
    flightEnd: null,
    liveDate: null,
    creativeDueDate: null,
    dueDate: null,
    dateCompleted: null,
    adStatus: 'Working on it',
    designStatus: 'Not Started',
    internalApproval: 'Pending Approval',
    clientApproval: 'Pending Approval',
    allocation: null,
    pacerActual: null,
    pacerDailyBudget: null,
    pacerTodayDate: null,
    pacerEndDate: null,
    creativeLink: null,
    clientName: null,
    digitalDetails: null,
    metaObjectType: null,
    metaObjectId: null,
    metaEffectiveStatus: null,
    pacerSyncedAt: null,
    pacerRunSpend: null,
    fullRunAppliedToMonth: null,
    lifetimeMonthSplit: null,
    metaStartDate: null,
    metaEndDate: null,
    alertsMuted: false,
    designNotes: [],
    activityLog: [],
  };
}

const PACER_ACTIVITY_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // mirror the API limit (25 MB)
function fmtBytes(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Period helpers ────────────────────────────────────────────────────────
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtPeriodLong(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}
function fmtPeriodShort(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Flight-date presets scoped to the ad's planning period (YYYY-MM).
 * Lets the user one-click "fill the whole month" instead of clicking through
 * the calendar — the original feature request that motivated the picker.
 */
function flightDatePresets(period: string): DatePreset[] {
  if (!isValidPeriod(period)) return [];
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstIso = `${y}-${pad(m)}-01`;
  const lastIso = `${y}-${pad(m)}-${pad(lastDay)}`;
  const midIso = `${y}-${pad(m)}-${pad(Math.min(14, lastDay))}`;
  return [
    {
      label: 'Full month',
      range: () => ({ start: firstIso, end: lastIso }),
    },
    {
      label: 'First half',
      range: () => ({ start: firstIso, end: midIso }),
    },
    {
      label: 'Second half',
      range: () => ({
        start: `${y}-${pad(m)}-${pad(Math.min(15, lastDay))}`,
        end: lastIso,
      }),
    },
  ];
}

const TODAY_PRESET: DatePreset = {
  label: 'Today',
  single: () => datePickerToIso(new Date()),
};

// ─── Filter types + helpers ────────────────────────────────────────────────
interface PlanFilters {
  status: string | null; // adStatus value | null
  source: 'all' | 'base' | 'added';
  adType: 'all' | 'Daily' | 'Lifetime';
  assigneeUserId: string | null;
  accountRepUserId: string | null;
  showMine: boolean;
  showOverdue: boolean;
  showNeedsApproval: boolean;
  showActive: boolean;
}

const EMPTY_FILTERS: PlanFilters = {
  status: null,
  source: 'all',
  adType: 'all',
  assigneeUserId: null,
  accountRepUserId: null,
  showMine: false,
  showOverdue: false,
  showNeedsApproval: false,
  showActive: false,
};

function filtersAreEmpty(f: PlanFilters): boolean {
  return (
    !f.status &&
    f.source === 'all' &&
    f.adType === 'all' &&
    !f.assigneeUserId &&
    !f.accountRepUserId &&
    !f.showMine &&
    !f.showOverdue &&
    !f.showNeedsApproval &&
    !f.showActive
  );
}

function isAdOverdue(ad: PacerAd): boolean {
  if (!ad.creativeDueDate || ad.designStatus === 'Approved') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(ad.creativeDueDate + 'T00:00:00') < today;
}

const ACTIVE_STATUSES = ['Live', 'Live - Changes Required'];

function applyFilters(
  ads: PacerAd[],
  filters: PlanFilters,
  currentUserId: string | null,
): PacerAd[] {
  if (filtersAreEmpty(filters)) return ads;
  return ads.filter((ad) => {
    if (filters.status && ad.adStatus !== filters.status) return false;
    if (filters.source !== 'all' && ad.budgetSource !== filters.source) return false;
    if (filters.adType !== 'all' && ad.budgetType !== filters.adType) return false;
    if (filters.accountRepUserId && ad.accountRepUserId !== filters.accountRepUserId) {
      return false;
    }
    if (filters.assigneeUserId) {
      const id = filters.assigneeUserId;
      if (
        ad.ownerUserId !== id &&
        ad.designerUserId !== id &&
        ad.accountRepUserId !== id
      ) {
        return false;
      }
    }
    if (filters.showMine && currentUserId) {
      if (
        ad.ownerUserId !== currentUserId &&
        ad.designerUserId !== currentUserId &&
        ad.accountRepUserId !== currentUserId
      ) {
        return false;
      }
    }
    if (filters.showOverdue && !isAdOverdue(ad)) return false;
    if (
      filters.showNeedsApproval &&
      ad.internalApproval !== 'Pending Approval' &&
      ad.clientApproval !== 'Pending Approval'
    ) {
      return false;
    }
    if (filters.showActive && !ACTIVE_STATUSES.includes(ad.adStatus)) return false;
    return true;
  });
}

/**
 * Read-only context for the pacer/planner (Change 5). True when the viewed
 * month is frozen, so editable primitives (DollarInput, the ad editor) and
 * mutation buttons disable themselves without prop-threading. The data layer
 * (autosave suppression + server 409 guards) is the real lock; this is the UX.
 */
const PacerReadOnlyContext = createContext(false);
const usePacerReadOnly = () => useContext(PacerReadOnlyContext);

/**
 * Lightweight CSS-hover tooltip. Wraps any trigger; shows `label` on hover/
 * focus-within. `placement` flips it above (default) or below the trigger —
 * use 'bottom' for triggers near the top of the page so it doesn't clip.
 */
function Tooltip({
  label,
  placement = 'top',
  children,
}: {
  label: string;
  placement?: 'top' | 'bottom';
  children: ReactNode;
}) {
  const pos = placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5';
  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${pos} z-[200] max-w-[220px] whitespace-normal text-center rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[10px] font-medium leading-snug text-[var(--foreground)] opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}

// ─── Shared input chrome ───────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)] text-[var(--foreground)]';
// Drop-in for places where we render a value inside a Field but the field
// is read-only (computed totals, "N/A" placeholders, etc.). Borderless +
// transparent bg + muted text + no horizontal padding so the value sits
// flush with the Field's label, not indented like an editable input.
const readonlyClass =
  'w-full py-2 text-sm bg-transparent text-[var(--muted-foreground)] cursor-default';
const labelClass =
  'block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5';

// ─── Atomic UI ─────────────────────────────────────────────────────────────
/** Compact "synced 2h ago" relative time from an ISO timestamp. */
function fmtSyncedAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function DollarInput({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const readOnly = usePacerReadOnly();
  const hasValue = value != null && value !== '';
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)] pointer-events-none">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ''}
        disabled={readOnly}
        onChange={(e) => {
          const v = e.target.value;
          // Accept only digits + a single decimal point. Reject anything else
          // so the field stays numeric without using <input type="number">
          // (which adds the spinner arrows we want gone).
          if (v === '' || /^\d*\.?\d*$/.test(v)) onChange(v);
        }}
        placeholder={placeholder ?? '0.00'}
        className={`${inputClass} pl-6 ${hasValue && !readOnly ? 'pr-8' : ''} ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
      {hasValue && !readOnly && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear amount"
          title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function Field({ label, color, children }: { label: string; color?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass} style={color ? { color } : undefined}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Status color tables: [bg, fg] pairs used by AdStatusPill, the StatusSelect
 * dropdown's colored options, and the StatusBattery overview bar. Adding a
 * status here automatically tints it everywhere it's rendered.
 */
// Design statuses use the same solid bg + white text family as ad statuses
// and approval pills so the three sit together visually as one signal set.
const DESIGN_STATUS_COLORS: Record<string, [string, string]> = {
  Approved: ['#22c55e', '#ffffff'],
  'Work In Progress': ['#fb923c', '#ffffff'],
  Stuck: ['#ef4444', '#ffffff'],
  'Revisions Needed': ['#facc15', '#ffffff'],
  'Not Started': ['var(--muted)', 'var(--muted-foreground)'],
  'In Proofing/Pending Approval': ['#0ea5e9', '#ffffff'],
  'N/A': ['var(--muted)', 'var(--muted-foreground)'],
};

// Internal & client approval pills share the same solid bg + white text
// treatment as ad statuses so the two read as the same family of signal.
const APPROVAL_STATUS_COLORS: Record<string, [string, string]> = {
  Approved: ['#22c55e', '#ffffff'],
  'Pending Approval': ['#f59e0b', '#ffffff'],
  'Does Not Approve': ['#ef4444', '#ffffff'],
  'Changes Requested': ['#0ea5e9', '#ffffff'],
};

// Solid bg + white text for ad statuses (Monday-style "filled" tags).
// DESIGN_STATUS_COLORS stays translucent — saturation there is reserved for
// non-primary signals.
const AD_STATUS_COLORS: Record<string, [string, string]> = {
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

function AdStatusPill({ status }: { status: string }) {
  const [bg, color] = AD_STATUS_COLORS[status] ?? ['var(--muted)', 'var(--muted-foreground)'];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

function ApprovalPill({ status }: { status: string }) {
  const [bg, color] =
    APPROVAL_STATUS_COLORS[status] ?? ['var(--muted)', 'var(--muted-foreground)'];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

function DesignPill({ status }: { status: string }) {
  const [bg, color] =
    DESIGN_STATUS_COLORS[status] ?? ['var(--muted)', 'var(--muted-foreground)'];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

/**
 * Monday-style status dropdown. The trigger renders the current value as a
 * full-width colored chip (matching the chosen status's theme). The popover
 * shows every option as its own colored chip — click to commit. Falls back
 * to the muted treatment when a status isn't in the colorMap.
 */
function StatusSelect({
  value,
  options,
  onChange,
  colorMap,
  className,
  size = 'md',
  ariaLabel,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  /** [bg, fg] tuple per option. Missing keys fall back to muted. */
  colorMap: Record<string, [string, string]>;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const popoverHeight = Math.min(360, options.length * 40 + 16);
    let top = rect.bottom + 4;
    if (top + popoverHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - popoverHeight - 4);
    }
    setPos({ top, left: rect.left, width: rect.width });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [bg, fg] = colorMap[value] ?? ['var(--muted)', 'var(--muted-foreground)'];
  const heightClass = size === 'sm' ? 'py-1.5' : 'py-2';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? value}
        className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg ${heightClass} px-3 text-xs font-bold uppercase tracking-wider transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 ${className ?? ''}`}
        style={{ background: bg, color: fg }}
      >
        <span className="truncate">{value || '—'}</span>
        <ChevronDownIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="listbox"
              className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl p-1.5"
              style={{
                top: pos.top,
                left: pos.left,
                width: Math.max(pos.width, 200),
              }}
            >
              <div className="max-h-[360px] overflow-y-auto themed-scrollbar space-y-1">
                {options.map((option) => {
                  const [optBg, optFg] = colorMap[option] ?? [
                    'var(--muted)',
                    'var(--muted-foreground)',
                  ];
                  const selected = option === value;
                  return (
                    <button
                      key={option}
                      role="option"
                      type="button"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                      className="w-full inline-flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity focus:outline-none"
                      style={{
                        background: optBg,
                        color: optFg,
                        boxShadow: selected
                          ? `inset 0 0 0 2px ${optFg}`
                          : undefined,
                      }}
                    >
                      <span className="truncate text-left">{option}</span>
                      {selected && (
                        <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MetricBox({
  label,
  value,
  sub,
  detail,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Optional faint second line — e.g. the arithmetic basis behind `value`. */
  detail?: string;
  color?: string;
}) {
  return (
    // No border + softer bg so it reads as a passive computed-info card,
    // not as another fillable field. Editable inputs stay bordered+filled.
    // `metric-box` lets the pacer card recess these into darker wells (see
    // `.pacer-ad-card .metric-box` in globals.css); harmless elsewhere.
    <div className="metric-box rounded-lg bg-[var(--muted)]/40 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
        {label}
      </div>
      <div className="text-lg font-bold leading-tight" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>
      )}
      {detail && (
        <div className="text-[10px] text-[var(--muted-foreground)]/75 mt-0.5 tabular-nums">
          {detail}
        </div>
      )}
    </div>
  );
}

// Tighter than MetricBox — single-line label + value, no sub text. Used
// in the Budget Calculator's stat strip where vertical space is
// precious (5+ stats in one row above a scrollable ad list).
function CompactStat({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 bg-[var(--muted)]/40 px-3 py-2.5" title={title}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] truncate mb-0.5">
        {label}
      </div>
      <div
        className="text-sm font-bold tabular-nums leading-snug whitespace-nowrap"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <h2 className="m-0 mb-3.5 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
      {icon}
      {text}
    </h2>
  );
}

/**
 * Battery-style segmented bar showing the breakdown of Ad Statuses across an
 * account's full ad list. Width of each segment = proportion of ads in that
 * status. Ordered by status priority (worst → best) so problems are visible
 * on the left.
 */
const STATUS_PRIORITY = [
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

/** Period selector — prev/next chevrons + native month input. */
function PeriodSelector({
  period,
  onChange,
}: {
  period: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, -1))}
        className="px-2 py-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        aria-label="Previous month"
      >
        <ChevronLeftIcon className="w-4 h-4" />
      </button>
      <input
        type="month"
        value={period}
        onChange={(e) => {
          const v = e.target.value;
          if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) onChange(v);
        }}
        className="bg-transparent text-sm font-semibold text-[var(--foreground)] px-2 py-1.5 focus:outline-none border-x border-[var(--border)] min-w-[140px]"
      />
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, 1))}
        className="px-2 py-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        aria-label="Next month"
      >
        <ChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

function StatusBattery({ ads, size = 'sm' }: { ads: PacerAd[]; size?: 'sm' | 'lg' }) {
  const total = ads.length;
  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    ads.forEach((a) => {
      const s = a.adStatus || 'In Draft';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    });
    return STATUS_PRIORITY.flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [{ status, count }] : [];
    });
  }, [ads]);

  const barHeight = size === 'lg' ? 'h-3.5' : 'h-2.5';
  const labelText = size === 'lg' ? 'text-[11px]' : 'text-[10px]';

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        <div className={`${barHeight} w-64 rounded-full border border-dashed border-[var(--border)]`} />
        <span>No ads yet</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 min-w-0 w-full">
      <div className="flex flex-col gap-1 min-w-[320px] flex-1">
        <div className={`flex ${barHeight} w-full rounded-full overflow-hidden bg-[var(--muted)] border border-[var(--border)]`}>
          {breakdown.map(({ status, count }) => {
            const w = (count / total) * 100;
            // [0] = bg color (the solid status color); [1] is the text color
            // (now #ffffff for every status, which would render the bar blank).
            const color = AD_STATUS_COLORS[status]?.[0] ?? 'var(--muted-foreground)';
            return (
              <div
                key={status}
                title={`${status}: ${count} of ${total} (${w.toFixed(0)}%)`}
                className="h-full transition-[width] duration-500"
                style={{ width: `${w}%`, background: color }}
              />
            );
          })}
        </div>
        <div className={`flex items-center gap-x-2 gap-y-0.5 ${labelText} text-[var(--muted-foreground)] flex-wrap`}>
          <span className="font-semibold text-[var(--foreground)]">
            {total} ad{total !== 1 ? 's' : ''}
          </span>
          {breakdown.map(({ status, count }) => {
            const color = AD_STATUS_COLORS[status]?.[0] ?? 'var(--muted-foreground)';
            return (
              <span
                key={status}
                className="inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span
                  className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                  style={{ background: color }}
                />
                {count} {status}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Divider({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 my-4">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap">
        {icon}
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

function BudgetTypeToggle({
  value,
  onChange,
}: {
  value: 'Daily' | 'Lifetime';
  onChange: (v: 'Daily' | 'Lifetime') => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--input)] overflow-hidden">
      {(['Daily', 'Lifetime'] as const).map((t) => {
        const active = value === t;
        const tint = t === 'Daily' ? 'rgba(56,189,248,0.18)' : 'rgba(167,139,250,0.18)';
        const fg = t === 'Daily' ? COLORS.daily : COLORS.lifetime;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              background: active ? tint : 'transparent',
              color: active ? fg : 'var(--muted-foreground)',
              borderRight: t === 'Daily' ? '1px solid var(--border)' : 'none',
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function BudgetSourceToggle({
  value,
  onChange,
}: {
  value: 'base' | 'added' | 'split';
  onChange: (v: 'base' | 'added' | 'split') => void;
}) {
  const opts = ['base', 'added', 'split'] as const;
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--input)] overflow-hidden">
      {opts.map((t, i) => {
        const active = value === t;
        const tint =
          t === 'base'
            ? 'rgba(56,189,248,0.18)'
            : t === 'added'
              ? 'rgba(52,211,153,0.18)'
              : 'rgba(167,139,250,0.22)';
        const fg =
          t === 'base'
            ? COLORS.base
            : t === 'added'
              ? COLORS.added
              : COLORS.lifetime;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              background: active ? tint : 'transparent',
              color: active ? fg : 'var(--muted-foreground)',
              borderRight: i < opts.length - 1 ? '1px solid var(--border)' : 'none',
            }}
            title={
              t === 'split'
                ? 'Split — allocation drawn from both Base and Added budgets'
                : undefined
            }
          >
            {t === 'base' ? 'Base' : t === 'added' ? 'Added' : 'Split'}
          </button>
        );
      })}
    </div>
  );
}

// ─── User picker (department-filtered) ─────────────────────────────────────
// Each role's picker pre-filters the directory to people in these departments
// (with a "Show all users" toggle to fall back to the full list). Mappings
// reflect the renamed PACER_DEPARTMENTS list.
const USER_DEPT_FILTERS = {
  owner: ['Account Representative', 'Digital'],
  designer: ['Graphic Design'],
  accountRep: ['Account Representative'],
} as const;

function UserPicker({
  users,
  value,
  onChange,
  filterFor,
  placeholder = '— Unassigned —',
}: {
  users: DirectoryUser[];
  value: string | null;
  onChange: (v: string | null) => void;
  filterFor: keyof typeof USER_DEPT_FILTERS;
  placeholder?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const allowedDepts = USER_DEPT_FILTERS[filterFor];

  const filteredUsers = useMemo(() => {
    const matched = users.filter((u) =>
      u.department ? (allowedDepts as readonly string[]).includes(u.department) : false,
    );
    return showAll ? users : matched;
  }, [users, showAll, allowedDepts]);

  // If selected user isn't in filtered list, ensure they still render
  const selected = users.find((u) => u.id === value);
  const finalList = useMemo(() => {
    if (selected && !filteredUsers.some((u) => u.id === selected.id)) {
      return [selected, ...filteredUsers];
    }
    return filteredUsers;
  }, [selected, filteredUsers]);

  return (
    <div className="space-y-1.5">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
      >
        <option value="">{placeholder}</option>
        {finalList.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.department ? ` · ${u.department}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setShowAll((p) => !p)}
        className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        {showAll ? 'Showing all users · filter to department' : 'Show all users'}
      </button>
    </div>
  );
}

// ─── Filter UI: status indicator + slide-from-right sidebar ────────────────
function activeFilterCount(f: PlanFilters): number {
  let n = 0;
  if (f.status) n++;
  if (f.source !== 'all') n++;
  if (f.adType !== 'all') n++;
  if (f.assigneeUserId) n++;
  if (f.accountRepUserId) n++;
  if (f.showMine) n++;
  if (f.showOverdue) n++;
  if (f.showNeedsApproval) n++;
  if (f.showActive) n++;
  return n;
}

function FilterChip({
  active,
  onClick,
  children,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  color?: string;
}) {
  const accent = color ?? 'var(--primary)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-full border transition-colors"
      style={{
        borderColor: active ? accent : 'var(--sidebar-border-soft)',
        background: active ? `${accent}1f` : 'transparent',
        color: active ? accent : 'var(--sidebar-muted-foreground)',
      }}
    >
      {children}
      {typeof count === 'number' && (
        <span
          className="text-[10px] font-semibold rounded-full px-1.5"
          style={{
            background: active ? `${accent}33` : 'var(--sidebar-muted)',
            color: active ? accent : 'var(--sidebar-muted-foreground)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Slim status row shown above the ad list inside each panel. */
function FilterStatus({
  filters,
  onClear,
  filteredCount,
  totalCount,
}: {
  filters: PlanFilters;
  onClear: () => void;
  filteredCount: number;
  totalCount: number;
}) {
  const active = activeFilterCount(filters);
  return (
    <div className="flex items-center justify-between gap-3 mb-3 text-[11px] text-[var(--muted-foreground)]">
      <div className="flex items-center gap-2">
        <span>
          Showing{' '}
          <span className="text-[var(--foreground)] font-semibold">{filteredCount}</span>{' '}
          of{' '}
          <span className="text-[var(--foreground)] font-semibold">{totalCount}</span>{' '}
          ad{totalCount !== 1 ? 's' : ''}
        </span>
        {active > 0 && (
          <>
            <span className="text-[var(--border)]">·</span>
            <span>
              {active} filter{active !== 1 ? 's' : ''} active
            </span>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowPathIcon className="w-3 h-3" />
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Filter sidebar — inline right-rail (FlowFilterSidebar pattern). Pass
 * `inline` so the parent grid lays it out alongside content rather than
 * over it; `className` controls open/closed slide animation.
 */
function MetaAdsPacerFilterSidebar({
  open,
  onClose,
  inline = false,
  className = '',
  filters,
  onChange,
  users,
  ads,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  inline?: boolean;
  className?: string;
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  users: DirectoryUser[];
  ads: PacerAd[];
  currentUserId: string | null;
}) {
  useEffect(() => {
    if (inline || !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inline, open, onClose]);

  const counts = useMemo(() => {
    const mine = currentUserId
      ? ads.filter(
          (a) =>
            a.ownerUserId === currentUserId ||
            a.designerUserId === currentUserId ||
            a.accountRepUserId === currentUserId,
        ).length
      : 0;
    const overdue = ads.filter(isAdOverdue).length;
    const needsApproval = ads.filter(
      (a) =>
        a.internalApproval === 'Pending Approval' ||
        a.clientApproval === 'Pending Approval',
    ).length;
    const active = ads.filter((a) => ACTIVE_STATUSES.includes(a.adStatus)).length;
    return { mine, overdue, needsApproval, active };
  }, [ads, currentUserId]);

  // Account-rep candidates = users actually assigned to ads in this plan.
  const accountRepUsers = useMemo(() => {
    const repIds = new Set(
      ads.map((a) => a.accountRepUserId).filter((id): id is string => !!id),
    );
    return users.filter((u) => repIds.has(u.id));
  }, [users, ads]);

  // Always render in inline mode so the grid layout can animate it; in
  // overlay mode we keep the previous "render only when open" behavior.
  if (!inline && !open) return null;
  if (!inline && typeof document === 'undefined') return null;
  const active = activeFilterCount(filters);
  const sidebarInputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 text-[var(--sidebar-foreground)] focus:outline-none focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30';
  const sectionLabelClass =
    'text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]';

  const panel = (
    <aside
      className={
        inline
          ? `rounded-2xl text-[var(--sidebar-foreground)] flex flex-col overflow-hidden ${className}`.trim()
          : 'glass-panel glass-panel-strong fixed right-3 top-3 bottom-3 w-[360px] rounded-2xl flex flex-col overflow-hidden'
      }
    >
        <div className="p-5 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-black dark:text-[var(--primary)]" />
            <h3 className="text-sm font-bold tracking-tight">Filters</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="themed-scrollbar flex-1 overflow-y-auto p-4 space-y-5">
          {/* Quick views */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Quick views</p>
            <div className="flex flex-wrap gap-1.5">
              {currentUserId && (
                <FilterChip
                  active={filters.showMine}
                  onClick={() => onChange({ ...filters, showMine: !filters.showMine })}
                  count={counts.mine}
                >
                  Mine
                </FilterChip>
              )}
              <FilterChip
                active={filters.showOverdue}
                onClick={() => onChange({ ...filters, showOverdue: !filters.showOverdue })}
                count={counts.overdue}
                color={COLORS.error}
              >
                Overdue
              </FilterChip>
              <FilterChip
                active={filters.showNeedsApproval}
                onClick={() =>
                  onChange({ ...filters, showNeedsApproval: !filters.showNeedsApproval })
                }
                count={counts.needsApproval}
                color={COLORS.warn}
              >
                Needs Approval
              </FilterChip>
              <FilterChip
                active={filters.showActive}
                onClick={() => onChange({ ...filters, showActive: !filters.showActive })}
                count={counts.active}
                color={COLORS.success}
              >
                Active
              </FilterChip>
            </div>
          </section>

          {/* Status */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Ad status</p>
              {filters.status && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, status: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.status ?? ''}
              onChange={(e) =>
                onChange({ ...filters, status: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">All statuses</option>
              {AD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </section>

          {/* Source */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Budget source</p>
            <div className="flex rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 overflow-hidden">
              {(['all', 'base', 'added'] as const).map((s) => {
                const isActive = filters.source === s;
                const accent =
                  s === 'base'
                    ? COLORS.base
                    : s === 'added'
                      ? COLORS.added
                      : 'var(--primary)';
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({ ...filters, source: s })}
                    className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: isActive ? `${accent}33` : 'transparent',
                      color: isActive ? accent : 'var(--sidebar-muted-foreground)',
                      borderRight:
                        s !== 'added'
                          ? '1px solid var(--sidebar-border-soft)'
                          : 'none',
                    }}
                  >
                    {s === 'all' ? 'All' : s === 'base' ? 'Base' : 'Added'}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Ad type */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Ad type</p>
            <div className="flex rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 overflow-hidden">
              {(['all', 'Daily', 'Lifetime'] as const).map((t) => {
                const isActive = filters.adType === t;
                const accent =
                  t === 'Daily'
                    ? COLORS.daily
                    : t === 'Lifetime'
                      ? COLORS.lifetime
                      : 'var(--primary)';
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ ...filters, adType: t })}
                    className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: isActive ? `${accent}33` : 'transparent',
                      color: isActive ? accent : 'var(--sidebar-muted-foreground)',
                      borderRight:
                        t !== 'Lifetime'
                          ? '1px solid var(--sidebar-border-soft)'
                          : 'none',
                    }}
                  >
                    {t === 'all' ? 'All' : t}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Account Rep */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Account Rep</p>
              {filters.accountRepUserId && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, accountRepUserId: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.accountRepUserId ?? ''}
              onChange={(e) =>
                onChange({ ...filters, accountRepUserId: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">Any rep</option>
              {accountRepUsers.length === 0 ? (
                <option value="" disabled>
                  No reps assigned to ads in this period
                </option>
              ) : (
                accountRepUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))
              )}
            </select>
          </section>

          {/* Assignee */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Assignee</p>
              {filters.assigneeUserId && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, assigneeUserId: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.assigneeUserId ?? ''}
              onChange={(e) =>
                onChange({ ...filters, assigneeUserId: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">Anyone assigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.department ? ` · ${u.department}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--sidebar-muted-foreground)] leading-relaxed">
              Matches ads where the user is the owner, designer, or account rep.
            </p>
          </section>
        </div>

        <div className="p-4 border-t border-[var(--sidebar-border-soft)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            disabled={active === 0}
            className="px-3 py-2 text-xs rounded-lg border border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] disabled:opacity-50 transition-colors"
          >
            Reset all
          </button>
          {inline ? (
            <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
              {active} active
            </span>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </aside>
  );

  if (inline) return panel;

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      {panel}
    </div>,
    document.body,
  );
}


// `buildAdCalc` / `AdCalc` and `buildPacerCalc` / `PacerCalc` are the shared
// pacing math (imported from ../_lib/pacer-calc) — one source of truth so the
// Pacer and Summary views can never drift. They take the current instant
// (`Date.now()`) and the account's IANA `timeZone` (plan.timeZone).

// ─── Plan Ad Card (rich Monday-mapped editor) ──────────────────────────────
// ─── Ad Summary Card (compact list view — opens modal on click) ────────────
/**
 * Monday-style chat-bubble indicator with a count badge in the bottom-right
 * corner. Used in both the table and card views to surface updates inline
 * with the ad name. Clicking it just opens the row (parent's onClick) — the
 * activity log itself lives inside the editor modal.
 */
function UpdatesIndicator({
  count,
  hasAttachments,
}: {
  count: number;
  hasAttachments: boolean;
}) {
  const hasCount = count > 0;
  const titleParts: string[] = [];
  titleParts.push(`${count} update${count === 1 ? '' : 's'}`);
  if (hasAttachments) titleParts.push('has attachments');
  return (
    <span
      className="relative inline-flex flex-shrink-0 items-center justify-center"
      title={titleParts.join(' · ')}
      style={{ width: 28, height: 28 }}
    >
      <ChatBubbleOvalLeftIcon
        className="w-6 h-6"
        style={{
          color: hasCount ? 'var(--primary)' : 'var(--muted-foreground)',
          opacity: hasCount ? 1 : 0.55,
        }}
      />
      {hasCount && (
        <span
          className="absolute flex items-center justify-center text-[9px] font-bold text-white rounded-full"
          style={{
            bottom: -2,
            right: -4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            background: 'var(--primary)',
            border: '2px solid var(--background)',
            lineHeight: 1,
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hasAttachments && (
        <PaperClipIcon
          className="absolute w-3 h-3 text-[var(--muted-foreground)]"
          style={{ top: -2, right: -2 }}
        />
      )}
    </span>
  );
}

/**
 * Drag-and-drop reorder for table rows and cards. Mimics the Monday.com
 * pattern:
 *   - whole row is grabbable (not just the handle icon)
 *   - source row stays at full opacity (no transparent ghost)
 *   - drop position is shown as a 2px primary-colored insertion line above
 *     or below the hovered row, depending on cursor Y position
 *   - browser drag preview is replaced with a clone so it stays solid
 *
 * Each consumer spreads `rowProps(id)` onto the draggable element and reads
 * `draggedId` / `dropTargetId` / `dropEdge` to render visual state.
 */
type DropEdge = 'top' | 'bottom';

interface DragReorderApi {
  draggedId: string | null;
  dropTargetId: string | null;
  dropEdge: DropEdge | null;
  rowProps: (id: string) => {
    draggable: true;
    onDragStart: (e: React.DragEvent<HTMLElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragEnter: (e: React.DragEvent<HTMLElement>) => void;
    onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
    onDrop: (e: React.DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
}

function useDragReorder(
  ads: PacerAd[],
  onReorder: (next: PacerAd[]) => void,
): DragReorderApi {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null);

  const reset = () => {
    setDraggedId(null);
    setDropTargetId(null);
    setDropEdge(null);
  };

  const rowProps = (id: string) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', id);
      } catch {
        // setData throws in some sandboxed contexts; safe to ignore.
      }

      // Replace the browser's translucent ghost with a solid clone of the
      // row positioned off-screen. This keeps the drag preview opaque,
      // matching the Monday-style "lifted card" feel.
      const target = e.currentTarget;
      try {
        const rect = target.getBoundingClientRect();
        const isTr = target.tagName === 'TR';
        const ghost = target.cloneNode(true) as HTMLElement;
        let mountTarget: HTMLElement = document.body;
        if (isTr) {
          // <tr> doesn't render outside a <table>; wrap it so the clone keeps
          // its row layout.
          const wrapper = document.createElement('table');
          wrapper.style.cssText = `
            position: absolute; top: -10000px; left: -10000px;
            width: ${rect.width}px;
            border-collapse: collapse;
            background: var(--card, #1a1a1a);
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            border-radius: 8px;
          `;
          const tbody = document.createElement('tbody');
          tbody.appendChild(ghost);
          wrapper.appendChild(tbody);
          document.body.appendChild(wrapper);
          mountTarget = wrapper;
        } else {
          ghost.style.cssText += `
            position: absolute; top: -10000px; left: -10000px;
            width: ${rect.width}px;
            background: var(--card, #1a1a1a);
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            opacity: 1;
          `;
          document.body.appendChild(ghost);
          mountTarget = ghost;
        }
        e.dataTransfer.setDragImage(
          mountTarget,
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        // Clean up after the browser has snapshotted the element.
        window.setTimeout(() => mountTarget.remove(), 0);
      } catch {
        // setDragImage isn't supported in every browser; falling back to the
        // default ghost is still functional, just less polished.
      }
    },
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!draggedId || draggedId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const edge: DropEdge = e.clientY < midpoint ? 'top' : 'bottom';
      if (dropTargetId !== id) setDropTargetId(id);
      if (dropEdge !== edge) setDropEdge(edge);
    },
    onDragEnter: (e: React.DragEvent<HTMLElement>) => {
      if (!draggedId || draggedId === id) return;
      e.preventDefault();
      setDropTargetId(id);
    },
    onDragLeave: () => {
      // Intentionally left blank — onDragEnter on siblings overwrites the
      // target, and clearing here causes flicker between rows.
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      const sourceId = draggedId;
      const edge = dropEdge;
      reset();
      if (!sourceId || sourceId === id) return;
      const fromIdx = ads.findIndex((a) => a.id === sourceId);
      const toIdx = ads.findIndex((a) => a.id === id);
      if (fromIdx === -1 || toIdx === -1) return;
      const next = [...ads];
      const [moved] = next.splice(fromIdx, 1);
      // After splice, indices >= fromIdx shift left by one.
      const baseTarget = fromIdx < toIdx ? toIdx - 1 : toIdx;
      const insertAt = edge === 'bottom' ? baseTarget + 1 : baseTarget;
      next.splice(insertAt, 0, moved);
      onReorder(next);
    },
    onDragEnd: () => {
      reset();
    },
  });

  return { draggedId, dropTargetId, dropEdge, rowProps };
}

function AdSummaryRow({
  ad,
  index,
  onClick,
  onRemove,
  onClone,
  dragProps,
  isDragging,
  isDropTarget,
  dropEdge,
  isSelected,
  onSelectToggle,
}: {
  ad: PacerAd;
  index: number;
  onClick: () => void;
  onRemove: (id: string) => void;
  onClone: (id: string) => void;
  dragProps?: ReturnType<DragReorderApi['rowProps']>;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropEdge?: DropEdge | null;
  isSelected: boolean;
  onSelectToggle: () => void;
}) {
  const readOnly = usePacerReadOnly();
  const allocation = num(ad.allocation);
  const isLifetime = ad.budgetType === 'Lifetime';
  const updatesCount = ad.activityLog.length;
  const showTopLine = isDropTarget && dropEdge === 'top';
  const showBottomLine = isDropTarget && dropEdge === 'bottom';

  // Drop indicator for table rows: a 2px primary-colored box-shadow on the
  // top or bottom edge. Using box-shadow (instead of border) avoids shifting
  // the row's height during drag.
  const dropShadow = showTopLine
    ? 'inset 0 2px 0 0 var(--primary)'
    : showBottomLine
      ? 'inset 0 -2px 0 0 var(--primary)'
      : undefined;

  return (
    <tr
      onClick={onClick}
      {...(dragProps && !readOnly ? dragProps : {})}
      style={{ boxShadow: dropShadow }}
      className={`group border-b border-[var(--border)] last:border-b-0 transition-colors hover:bg-[var(--muted)]/50 ${
        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${isSelected ? 'bg-[var(--primary)]/8' : ''} ${
        isDragging ? 'bg-[var(--primary)]/10' : ''
      }`}
    >
      {/* Bulk-selection checkbox (clicking it stops the row's click-to-edit) */}
      <td
        className="w-9 pl-3 pr-1 py-2 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={`Select ${ad.name || 'Untitled Ad'}`}
          checked={isSelected}
          onChange={onSelectToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-[var(--border)] bg-[var(--input)] text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
        />
      </td>

      {/* Color + name */}
      <td className="px-3 py-2 align-middle min-w-[200px]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-sm flex-shrink-0"
            style={{ background: AD_COLORS[index % AD_COLORS.length] }}
          />
          <span className="text-sm font-semibold text-[var(--foreground)] truncate">
            {ad.name || 'Untitled Ad'}
          </span>
        </div>
      </td>

      {/* Updates indicator (own column so icons align across rows; no header) */}
      <td className="w-10 px-2 py-2 align-middle">
        <UpdatesIndicator
          count={updatesCount}
          hasAttachments={ad.activityLog.some((e) => e.attachmentKey)}
        />
      </td>

      {/* Status */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <AdStatusPill status={ad.adStatus} />
      </td>

      {/* Due date chip */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <DueDateChip ad={ad} />
      </td>

      {/* Budget tags */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <div className="flex items-center gap-1">
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              background: isLifetime
                ? 'rgba(167,139,250,0.18)'
                : 'rgba(56,189,248,0.18)',
              color: isLifetime ? COLORS.lifetime : COLORS.daily,
            }}
          >
            {ad.budgetType}
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              background: sourceTint(ad.budgetSource),
              color: sourceColor(ad.budgetSource),
            }}
          >
            {sourceLabel(ad.budgetSource)}
          </span>
        </div>
      </td>

      {/* Allocation */}
      <td
        className="px-3 py-2 align-middle text-xs font-semibold whitespace-nowrap"
        style={{
          color: sourceColor(ad.budgetSource),
        }}
      >
        {allocation != null ? fmt(allocation) : '—'}
      </td>

      {/* Flight */}
      <td className="px-3 py-2 align-middle text-xs text-[var(--foreground)] whitespace-nowrap">
        {ad.flightStart && ad.flightEnd
          ? `${fmtDate(ad.flightStart)} – ${fmtDate(ad.flightEnd)}`
          : '—'}
      </td>

      {/* Design */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <DesignPill status={ad.designStatus} />
      </td>

      {/* Approvals */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-5 flex-shrink-0">
              Int
            </span>
            <ApprovalPill status={ad.internalApproval} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-5 flex-shrink-0">
              Cli
            </span>
            <ApprovalPill status={ad.clientApproval} />
          </div>
        </div>
      </td>

      {/* Hover-only actions — hidden on a frozen month (read-only). */}
      <td className="px-3 py-2 align-middle whitespace-nowrap text-right">
        {!readOnly && (
          <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClone(ad.id);
              }}
              className="text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] rounded p-1 transition-colors"
              aria-label="Clone ad"
              title="Clone ad"
            >
              <DocumentDuplicateIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(ad.id);
              }}
              className="text-[var(--muted-foreground)] hover:text-red-400 hover:bg-[var(--muted)] rounded p-1 transition-colors"
              aria-label="Remove ad"
              title="Remove ad"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

// ─── Activity Log Panel — sidebar inside the editor modal ──────────────────
function ActivityAttachmentPreview({ entry }: { entry: ActivityEntry }) {
  if (!entry.attachmentUrl || !entry.attachmentFilename) return null;
  const isImage = !!entry.attachmentMimeType?.startsWith('image/');
  return (
    <div className="mt-2">
      {isImage && (
        <a href={entry.attachmentUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={entry.attachmentUrl}
            alt={entry.attachmentFilename}
            className="max-w-full max-h-48 rounded-md border border-[var(--border)] object-contain bg-[var(--muted)]"
          />
        </a>
      )}
      <a
        href={entry.attachmentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-2 max-w-full text-[11px] text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
      >
        {isImage ? (
          <PhotoIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--primary)]" />
        ) : (
          <DocumentIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--primary)]" />
        )}
        <span className="truncate underline underline-offset-2">
          {entry.attachmentFilename}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
          {fmtBytes(entry.attachmentSize)}
        </span>
      </a>
    </div>
  );
}

function ActivityLogPanel({
  ad,
  users,
  currentUserId,
  onAdd,
  onEdit,
  onDelete,
}: {
  ad: PacerAd;
  users: DirectoryUser[];
  currentUserId: string | null;
  onAdd: (adId: string, text: string, file: File | null) => Promise<void>;
  onEdit: (adId: string, entryId: string, text: string) => Promise<void>;
  onDelete: (adId: string, entryId: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Inline edit: tracks which entry id is in edit mode and the working text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const userById = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (picked.size > PACER_ACTIVITY_MAX_UPLOAD_BYTES) {
      setErrorMsg(
        `File is ${fmtBytes(picked.size)} — exceeds the ${PACER_ACTIVITY_MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
      );
      // Reset the input so the same file can be retried after picking another
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFile(picked);
    setErrorMsg(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAdd = async () => {
    const t = text.trim();
    if ((!t && !file) || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onAdd(ad.id, t, file);
      setText('');
      clearFile();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post entry');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entryId: string, currentText: string) => {
    setEditingId(entryId);
    setEditText(currentText);
    setEditError(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditError(null);
  };
  const saveEdit = async (entryId: string) => {
    const t = editText.trim();
    if (!t || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await onEdit(ad.id, entryId, t);
      cancelEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <aside className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--muted)]/30 min-h-0">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChatBubbleOvalLeftIcon className="w-4 h-4 text-[var(--primary)]" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--foreground)]">
            Updates
          </h3>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {ad.activityLog.length}{' '}
          {ad.activityLog.length === 1 ? 'update' : 'updates'}
        </span>
      </div>

      <div className="themed-scrollbar flex-1 overflow-y-auto p-3 space-y-2">
        {ad.activityLog.length === 0 ? (
          <p className="text-[11px] text-[var(--muted-foreground)] text-center py-6">
            No updates yet. Add a comment, update, or attachment below.
          </p>
        ) : (
          // Chronological order: oldest at top, newest at bottom — same flow
          // as a chat thread. Removed the `.reverse()` that previously put
          // new posts on top.
          ad.activityLog.map((u) => {
            const isMine = !!currentUserId && u.authorUserId === currentUserId;
            const isEditing = editingId === u.id;
            const author = u.authorUserId ? userById.get(u.authorUserId) : null;
            const stamp = new Date(u.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <div
                key={u.id}
                className={`rounded-lg border px-3 py-2 ${
                  isMine
                    ? 'border-[var(--primary)]/40 bg-[var(--primary)]/12'
                    : 'border-[var(--border)] bg-[var(--card)]'
                }`}
              >
                <div className="flex justify-between items-start mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {author && (
                      <UserAvatar
                        name={author.name}
                        email={author.email}
                        avatarUrl={author.avatarUrl}
                        size={28}
                        className={`w-7 h-7 rounded-full object-cover flex-shrink-0 border ${
                          isMine
                            ? 'border-[var(--primary)]/60'
                            : 'border-[var(--border)]'
                        }`}
                      />
                    )}
                    <div className="flex flex-col min-w-0 leading-tight">
                      <span
                        className={`text-xs font-semibold truncate ${
                          isMine ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                        }`}
                      >
                        {author?.name ?? 'Unknown'}
                      </span>
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                        {stamp}
                      </span>
                    </div>
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isMine && u.text && (
                        <button
                          type="button"
                          onClick={() => startEdit(u.id, u.text)}
                          className="text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                          aria-label="Edit update"
                          title="Edit"
                        >
                          <PencilSquareIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(ad.id, u.id)}
                        className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                        aria-label="Delete entry"
                        title="Delete"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          saveEdit(u.id);
                        } else if (e.key === 'Escape') {
                          cancelEdit();
                        }
                      }}
                      className={`${inputClass} resize-none leading-relaxed`}
                    />
                    {editError && (
                      <p className="text-[10px] text-red-400">{editError}</p>
                    )}
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={editSaving}
                        className="px-2 py-1 text-[10px] font-medium rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(u.id)}
                        disabled={editSaving || !editText.trim()}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <CheckIcon className="w-3 h-3" />
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  u.text && (
                    <p className="m-0 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">
                      {u.text}
                    </p>
                  )
                )}
                {!isEditing && <ActivityAttachmentPreview entry={u} />}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[var(--border)] bg-[var(--card)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment or log an update…"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd();
          }}
          className={`${inputClass} resize-none leading-relaxed mb-2`}
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFilePick}
        />

        {file && (
          <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]">
            <div className="flex items-center gap-2 min-w-0">
              <PaperClipIcon className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
              <span className="text-[11px] text-[var(--foreground)] truncate">
                {file.name}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
                {fmtBytes(file.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors flex-shrink-0"
              aria-label="Remove attachment"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {errorMsg && (
          <p className="mb-2 text-[10px] text-red-400">{errorMsg}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              title={`Attach a file (max ${PACER_ACTIVITY_MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`}
            >
              <PaperClipIcon className="w-3 h-3" />
              Attach
            </button>
            <span>⌘/Ctrl+Enter to post</span>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || (!text.trim() && !file)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium hover:bg-[var(--primary)]/20 transition-colors disabled:opacity-50"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Post
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Plan Ad Form — full editable form, used inside the editor modal ───────
function PlanAdForm({
  ad,
  users,
  onUpdate,
  markup,
}: {
  ad: PacerAd;
  users: DirectoryUser[];
  onUpdate: (ad: PacerAd) => void;
  // §0.1: resolved per-account factor (override, else agency default), passed
  // down so the Gross Allocation display grosses up at the right rate.
  markup: number | null;
}) {
  const days = calcDays(ad.flightStart, ad.flightEnd);
  const allocation = num(ad.allocation) ?? 0;

  const userById = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);
  const accountRepUser = ad.accountRepUserId ? userById.get(ad.accountRepUserId) : null;

  const designOverdue = (() => {
    if (!ad.creativeDueDate || ad.designStatus === 'Approved') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(ad.creativeDueDate + 'T00:00:00');
    const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0)
      return {
        icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" />,
        label: `Overdue ${Math.abs(diff)}d`,
        bg: 'rgba(239,68,68,0.18)',
        color: '#fca5a5',
      };
    if (diff === 0)
      return {
        icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" />,
        label: 'Due today',
        bg: 'rgba(252,211,77,0.18)',
        color: '#fcd34d',
      };
    if (diff <= 3)
      return {
        icon: <ClockIcon className="w-3.5 h-3.5" />,
        label: `Due in ${diff}d`,
        bg: 'rgba(252,211,77,0.18)',
        color: '#fcd34d',
      };
    if (diff <= 7)
      return {
        icon: <CalendarIcon className="w-3.5 h-3.5" />,
        label: `Due in ${diff}d`,
        bg: 'rgba(190,242,100,0.18)',
        color: '#bef264',
      };
    return null;
  })();

  return (
    <div>
          <Divider
            icon={<ClipboardDocumentListIcon className="w-3 h-3" />}
            label="Ad Details"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Owner / Assigned To">
              <UserPicker
                users={users}
                value={ad.ownerUserId}
                filterFor="owner"
                onChange={(v) => onUpdate({ ...ad, ownerUserId: v })}
              />
            </Field>
          </div>

          <div className="mb-3">
            <Field label="Digital Details">
              <textarea
                value={ad.digitalDetails ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, digitalDetails: e.target.value || null })
                }
                rows={4}
                placeholder="Goal, audience, targeting notes, copy direction…"
                className={`${inputClass} resize-y leading-relaxed min-h-[88px]`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
            <Field label="Action Needed">
              <select
                value={ad.actionNeeded ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, actionNeeded: e.target.value || null })
                }
                className={inputClass}
              >
                <option value="">—</option>
                {ACTION_NEEDED.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recurring?">
              <select
                value={ad.recurring}
                onChange={(e) => onUpdate({ ...ad, recurring: e.target.value })}
                className={inputClass}
              >
                {RECURRING_OPTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Co-op?">
              <select
                value={ad.coop}
                onChange={(e) => onUpdate({ ...ad, coop: e.target.value })}
                className={inputClass}
              >
                {COOP_OPTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ad Status">
              <StatusSelect
                value={ad.adStatus}
                options={AD_STATUSES}
                colorMap={AD_STATUS_COLORS}
                onChange={(newStatus) => {
                  const today = datePickerToIso(new Date());
                  onUpdate({
                    ...ad,
                    adStatus: newStatus,
                    dateCompleted:
                      newStatus === 'Live' && !ad.dateCompleted
                        ? today
                        : ad.dateCompleted,
                  });
                }}
                ariaLabel="Ad status"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Due Date">
              <div className="relative">
                <DatePicker
                  value={ad.dueDate}
                  onChange={(v) => onUpdate({ ...ad, dueDate: v })}
                  placeholder="Pick a date"
                  presets={[TODAY_PRESET]}
                />
                {ad.dueDate &&
                  ad.flightStart &&
                  ad.dueDate === autoDueDateFromFlightStart(ad.flightStart) && (
                    <span
                      className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: COLORS.daily }}
                    >
                      ● Auto-set from flight start
                    </span>
                  )}
              </div>
            </Field>
            <Field label="Date Completed">
              <div className="relative">
                <DatePicker
                  value={ad.dateCompleted}
                  onChange={(v) => onUpdate({ ...ad, dateCompleted: v })}
                  placeholder="Pick a date"
                  presets={[TODAY_PRESET]}
                />
                {ad.dateCompleted && ad.adStatus === 'Live' && (
                  <span
                    className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: COLORS.success }}
                  >
                    ● Auto-filled when set Live
                  </span>
                )}
              </div>
            </Field>
          </div>

          {/* Flight Dates */}
          <Divider icon={<CalendarIcon className="w-3 h-3" />} label="Flight Dates" />
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-2.5 mb-3">
            <Field label="Flight Range (Start – End)">
              <DatePicker
                mode="range"
                value={{ start: ad.flightStart, end: ad.flightEnd }}
                onChange={(r) => {
                  const next = r.start;
                  const previousAuto = autoDueDateFromFlightStart(ad.flightStart);
                  const dueDateIsAuto =
                    ad.dueDate == null || ad.dueDate === previousAuto;
                  onUpdate({
                    ...ad,
                    flightStart: r.start,
                    flightEnd: r.end,
                    dueDate: dueDateIsAuto
                      ? autoDueDateFromFlightStart(next)
                      : ad.dueDate,
                  });
                }}
                placeholder="Click & drag to select flight window"
                presets={flightDatePresets(ad.period)}
              />
            </Field>
            <Field label="Actual Live Date" color={COLORS.success}>
              <DatePicker
                value={ad.liveDate}
                onChange={(v) => onUpdate({ ...ad, liveDate: v })}
                placeholder="Not yet live"
                presets={[TODAY_PRESET]}
              />
              {ad.liveDate && ad.flightStart && ad.liveDate > ad.flightStart && (
                <span
                  className="mt-1 inline-block text-[10px] font-bold"
                  style={{ color: COLORS.warn }}
                >
                  +{calcDays(ad.flightStart, ad.liveDate) - 1}d late
                </span>
              )}
            </Field>
            <Field label="Effective Duration">
              <div
                className={`${readonlyClass} font-bold`}
                style={{
                  color:
                    ad.liveDate && ad.flightEnd
                      ? COLORS.success
                      : days > 0
                        ? COLORS.daily
                        : 'var(--muted-foreground)',
                }}
              >
                {ad.liveDate && ad.flightEnd
                  ? `${calcDays(ad.liveDate, ad.flightEnd)} days`
                  : days > 0
                    ? `${days} days`
                    : 'Set dates'}
              </div>
            </Field>
          </div>

          {/* Budget */}
          <Divider icon={<ChartBarIcon className="w-3 h-3" />} label="Budget" />
          <div className="flex flex-wrap gap-2.5 mb-3 items-end">
            <Field label="Budget Type">
              <BudgetTypeToggle
                value={ad.budgetType}
                onChange={(v) => onUpdate({ ...ad, budgetType: v })}
              />
            </Field>
            <Field label="Budget Source">
              <BudgetSourceToggle
                value={ad.budgetSource}
                onChange={(v) => onUpdate({ ...ad, budgetSource: v })}
              />
            </Field>
          </div>
          <div className="mb-3 flex flex-wrap gap-3 items-end">
            <Field
              label="Actual Spend Amount"
              color={
                ad.budgetSource === 'base'
                  ? COLORS.base
                  : ad.budgetSource === 'added'
                    ? COLORS.added
                    : COLORS.lifetime
              }
            >
              {/* Sized for ~$999,999.99 — wide enough for 6 digits + cents
                  without dominating the form like a full-width input. */}
              <div className="w-[180px]">
                <DollarInput
                  value={ad.allocation}
                  onChange={(v) => onUpdate({ ...ad, allocation: v })}
                  placeholder="0.00"
                />
              </div>
            </Field>
            {ad.budgetSource === 'split' && (
              <Field label="Base Portion" color={COLORS.base}>
                <div className="w-[160px]">
                  <DollarInput
                    value={ad.splitBaseAmount}
                    onChange={(v) =>
                      onUpdate({ ...ad, splitBaseAmount: v ?? null })
                    }
                    placeholder="0.00"
                  />
                </div>
              </Field>
            )}
          </div>

          {ad.budgetSource === 'split' && allocation > 0 && (
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              {(() => {
                const baseAlloc = Math.min(
                  Math.max(0, num(ad.splitBaseAmount) ?? 0),
                  allocation,
                );
                const addedAlloc = allocation - baseAlloc;
                return (
                  <>
                    <span style={{ color: COLORS.base }} className="font-semibold">
                      Base: {fmt(baseAlloc)}
                    </span>
                    {' · '}
                    <span style={{ color: COLORS.added }} className="font-semibold">
                      Added: {fmt(addedAlloc)}
                    </span>
                    {baseAlloc > allocation && (
                      <span style={{ color: COLORS.error }} className="ml-2">
                        Base Portion exceeds the total allocation
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {allocation > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
              <MetricBox
                label="Gross Allocation"
                value={
                  effMarkupOf(markup) > 0
                    ? fmt(Math.round((allocation / effMarkupOf(markup)) * 100) / 100)
                    : '—'
                }
                sub="client budget"
              />
              <MetricBox
                label="Actual Spend"
                value={fmt(allocation)}
                color={
                  ad.budgetSource === 'base'
                    ? COLORS.base
                    : ad.budgetSource === 'added'
                      ? COLORS.added
                      : COLORS.lifetime
                }
              />
            </div>
          )}

          {/* Creative & Design */}
          <Divider
            icon={<PaintBrushIcon className="w-3 h-3" />}
            label="Creative & Design"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3">
            <Field label="Design Status">
              <StatusSelect
                value={ad.designStatus}
                options={DESIGN_STATUSES}
                colorMap={DESIGN_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, designStatus: v })}
                ariaLabel="Design status"
              />
            </Field>
            <Field label="Designer Assigned">
              <UserPicker
                users={users}
                value={ad.designerUserId}
                filterFor="designer"
                onChange={(v) => onUpdate({ ...ad, designerUserId: v })}
              />
            </Field>
            <Field label="Creative Due Date">
              <DatePicker
                value={ad.creativeDueDate}
                onChange={(v) => onUpdate({ ...ad, creativeDueDate: v })}
                placeholder="Pick a date"
                presets={[TODAY_PRESET]}
              />
              {designOverdue && (
                <div
                  className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md border"
                  style={{
                    background: designOverdue.bg,
                    borderColor: `${designOverdue.color}60`,
                    color: designOverdue.color,
                  }}
                >
                  {designOverdue.icon}
                  <span className="text-[10px] font-bold">{designOverdue.label}</span>
                </div>
              )}
            </Field>
          </div>
          <div className="mb-3 max-w-xl">
            <Field label="Creative Link">
              <div className="relative">
                <input
                  value={ad.creativeLink ?? ''}
                  onChange={(e) =>
                    onUpdate({ ...ad, creativeLink: e.target.value || null })
                  }
                  placeholder="https://…"
                  className={`${inputClass} ${ad.creativeLink ? 'pr-10' : ''}`}
                />
                {ad.creativeLink && (
                  <a
                    href={ad.creativeLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open creative link in new tab"
                    title="Open in new tab"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                )}
              </div>
            </Field>
          </div>

          {/* Approvals */}
          <Divider icon={<CheckBadgeIcon className="w-3 h-3" />} label="Approvals" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Account Rep">
              <UserPicker
                users={users}
                value={ad.accountRepUserId}
                filterFor="accountRep"
                onChange={(v) => onUpdate({ ...ad, accountRepUserId: v })}
              />
            </Field>
            <Field label="Client Name">
              <input
                value={ad.clientName ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, clientName: e.target.value || null })
                }
                placeholder="Client decision-maker name…"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Internal Approval">
              <StatusSelect
                value={ad.internalApproval}
                options={APPROVAL_STATUSES}
                colorMap={APPROVAL_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, internalApproval: v })}
                ariaLabel="Internal approval"
              />
            </Field>
            <Field label="Client Approval">
              <StatusSelect
                value={ad.clientApproval}
                options={APPROVAL_STATUSES}
                colorMap={APPROVAL_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, clientApproval: v })}
                ariaLabel="Client approval"
              />
            </Field>
          </div>
          {/* Approval status summary — clearly labeled by source */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-1 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <UserCircleIcon className="w-3.5 h-3.5" />
                Internal
                {accountRepUser && (
                  <span className="ml-1 text-[var(--foreground)] normal-case tracking-normal">
                    · {accountRepUser.name}
                  </span>
                )}
              </span>
              <ApprovalPill status={ad.internalApproval} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <UserCircleIcon className="w-3.5 h-3.5" />
                Client
                {ad.clientName && (
                  <span className="ml-1 text-[var(--foreground)] normal-case tracking-normal">
                    · {ad.clientName}
                  </span>
                )}
              </span>
              <ApprovalPill status={ad.clientApproval} />
            </div>
          </div>

    </div>
  );
}

// ─── Ad Editor Modal — full-screen modal wrapping PlanAdForm ───────────────
/**
 * Editor modal with a local draft. Form edits stay in the modal until the
 * user clicks Save; Cancel/X with no changes closes immediately, with
 * changes prompts to discard. The parent autosave is paused while this
 * modal is mounted so debounced PUTs don't fire on transient draft state.
 *
 * `mode='create'` means the ad isn't in the plan yet — Save appends it.
 * `mode='edit'` means it's an existing ad — Save replaces it in place.
 */
function AdEditorModal({
  initialAd,
  markup,
  liveActivityLog,
  mode,
  users,
  currentUserId,
  onSave,
  onCancel,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
}: {
  initialAd: PacerAd;
  /** §0.1 resolved per-account markup factor, threaded to PlanAdForm. */
  markup: number | null;
  /**
   * The current activity log for this ad pulled from the parent plan. The
   * modal's draft state is for form fields only — activity entries persist
   * immediately and need to read live data so newly posted/edited/deleted
   * entries appear without closing the modal.
   */
  liveActivityLog?: ActivityEntry[];
  mode: 'create' | 'edit';
  users: DirectoryUser[];
  currentUserId: string | null;
  onSave: (ad: PacerAd) => void;
  onCancel: () => void;
  onAddActivity: (adId: string, text: string, file: File | null) => Promise<void>;
  onEditActivity: (adId: string, entryId: string, text: string) => Promise<void>;
  onDeleteActivity: (adId: string, entryId: string) => Promise<void>;
}) {
  const readOnly = usePacerReadOnly();
  const [draft, setDraft] = useState<PacerAd>(initialAd);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Reset draft if the parent swaps in a different ad while the modal is
  // mounted (e.g. opens a different row). Cheap stringify is enough since
  // PacerAd is plain data with no functions.
  const initialKey = initialAd.id;
  useEffect(() => {
    setDraft(initialAd);
    setEditingTitle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialAd),
    [draft, initialAd],
  );

  const tryClose = () => {
    if (
      isDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes?')
    ) {
      return;
    }
    onCancel();
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') tryClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // tryClose is recreated each render; rebinding is fine and cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, initialAd]);

  if (typeof document === 'undefined') return null;

  const accentColor = AD_STATUS_COLORS[draft.adStatus]?.[1] ?? 'var(--border)';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-stretch justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={tryClose}
      />
      <div className="glass-modal relative my-6 mx-4 w-full max-w-6xl rounded-2xl flex flex-col overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: accentColor }}
        />
        {/* Modal header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <ClipboardDocumentListIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTitle(false);
                    }
                  }}
                  placeholder="New Ad"
                  className="w-full bg-transparent text-xl font-bold text-[var(--foreground)] focus:outline-none border-b border-[var(--primary)] py-0.5"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  disabled={readOnly}
                  className="group/title inline-flex items-center gap-2 text-xl font-bold text-[var(--foreground)] truncate max-w-full hover:text-[var(--primary)] transition-colors text-left disabled:hover:text-[var(--foreground)] disabled:cursor-default"
                  title={readOnly ? draft.name?.trim() || 'New Ad' : 'Click to edit ad name'}
                >
                  <span className="truncate">
                    {draft.name?.trim() || 'New Ad'}
                  </span>
                  {!readOnly && (
                    <PencilSquareIcon className="w-4 h-4 flex-shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity text-[var(--muted-foreground)]" />
                  )}
                </button>
              )}
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {mode === 'create'
                  ? 'Cancel discards this ad. Save adds it to the plan.'
                  : isDirty
                    ? 'Unsaved changes — Save to commit, Cancel to discard.'
                    : 'Click the title to rename.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={tryClose}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onSave(draft)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white text-xs font-medium hover:bg-[var(--primary)] transition-colors"
              >
                Save
              </button>
            )}
            <button
              type="button"
              onClick={tryClose}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              aria-label="Close"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal body — form on the left, activity log on the right */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_340px]">
          <div className="themed-scrollbar overflow-y-auto p-5">
            {/* A disabled fieldset (display:contents → no layout change)
                locks every form control at once when the month is frozen. */}
            <fieldset disabled={readOnly} className="contents">
              <PlanAdForm ad={draft} users={users} onUpdate={setDraft} markup={markup} />
            </fieldset>
          </div>
          {mode === 'create' ? (
            <aside className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--muted)]/30 p-6 text-center justify-center">
              <ChatBubbleOvalLeftIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2" />
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Activity log unlocks once the ad is saved. Click <b>Save</b> to add
                this ad to the plan, then re-open it to leave comments or
                attachments.
              </p>
            </aside>
          ) : (
            <ActivityLogPanel
              // Render with the LIVE activity log (from parent plan) so
              // posts/edits/deletes show up immediately. Form-field draft
              // is unaffected.
              ad={{ ...draft, activityLog: liveActivityLog ?? draft.activityLog }}
              users={users}
              currentUserId={currentUserId}
              onAdd={onAddActivity}
              onEdit={onEditActivity}
              onDelete={onDeleteActivity}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Budget Panel (base / added) ───────────────────────────────────────────
function BudgetPanel({
  title,
  source,
  color,
  goalKey,
  plan,
  onChange,
}: {
  title: string;
  source: 'base' | 'added';
  color: string;
  goalKey: 'baseBudgetGoal' | 'addedBudgetGoal';
  plan: PacerPlan;
  onChange: (p: PacerPlan) => void;
}) {
  const goal = num(plan[goalKey]);
  // Include split ads here too — their per-source portion contributes
  // to this pool's totals via adContribution. Pure-source ads only
  // contribute to one side, but a split ad contributes to both.
  const srcAds = plan.ads.filter(
    (a) => a.budgetSource === source || a.budgetSource === 'split',
  );
  const totalAlloc = plan.ads.reduce((s, a) => {
    const c = adContribution(a);
    return s + (source === 'base' ? c.baseAllocation : c.addedAllocation);
  }, 0);
  // Per-account markup override when set, else the global default.
  const effMarkup = effMarkupOf(plan.markup);
  // Carryover (Change 7) adjusts the DERIVED spend target only — the client
  // budget goal stays untouched. target = goal × markup + carryover.
  const carryover =
    num(source === 'base' ? plan.baseCarryover : plan.addedCarryover) ?? 0;
  const baseTarget = goal != null ? goal * effMarkup : null;
  const spendTarget = baseTarget != null ? baseTarget + carryover : null;
  const grossAlloc = Math.round((totalAlloc / effMarkup) * 100) / 100;
  const remaining = spendTarget != null ? spendTarget - totalAlloc : null;
  const allocPct =
    spendTarget != null && spendTarget > 0
      ? (totalAlloc / spendTarget) * 100
      : null;
  const allocStatus =
    allocPct == null ? null : allocPct > 105 ? 'over' : allocPct >= 95 ? 'perfect' : 'under';
  const statusColor =
    allocStatus === 'over'
      ? COLORS.error
      : allocStatus === 'perfect'
        ? COLORS.success
        : COLORS.warn;

  return (
    <div
      className="glass-section-card relative flex-1 min-w-[280px] rounded-xl px-5 py-4 overflow-hidden"
      style={{ borderColor: `${color}40` }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: color }}
      />

      <div className="flex items-center justify-between mb-3.5">
        <span
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color }}
        >
          {title}
        </span>
        {allocStatus && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{
              background:
                allocStatus === 'over'
                  ? 'rgba(239,68,68,0.18)'
                  : allocStatus === 'perfect'
                    ? 'rgba(34,197,94,0.18)'
                    : 'rgba(245,158,11,0.18)',
              color: statusColor,
            }}
          >
            {allocStatus === 'over'
              ? 'Over'
              : allocStatus === 'perfect'
                ? 'Full'
                : 'Under'}
          </span>
        )}
      </div>

      {/* Goal input row */}
      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        <Field label="Client Budget Goal (Gross)">
          <DollarInput
            value={plan[goalKey]}
            onChange={(v) => onChange({ ...plan, [goalKey]: v })}
            placeholder="0.00"
          />
        </Field>
        <Field label="Actual Spend Budget">
          <div
            className={`${readonlyClass} font-bold`}
            style={{ color }}
          >
            {spendTarget != null
              ? fmt(Math.round(spendTarget * 100) / 100)
              : '—'}
          </div>
          {/* When a carryover is applied, show the traceable breakdown so the
              target always reads as "base × markup + carryover", never a
              silently moved number. */}
          {carryover !== 0 && baseTarget != null && (
            <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5 leading-snug">
              {fmt(Math.round(baseTarget * 100) / 100)}{' '}
              {carryover >= 0 ? '+' : '−'} {fmt(Math.abs(carryover))} carried
              from {fmtPeriodShort(shiftPeriod(plan.period, -1))}
            </div>
          )}
        </Field>
      </div>

      {/* Metric boxes */}
      <div
        className="grid grid-cols-2 md:grid-cols-3 gap-2"
        style={{ marginBottom: goal != null && goal > 0 ? 14 : 0 }}
      >
        <MetricBox
          label="Gross Allocation"
          value={fmt(grossAlloc)}
          sub={carryover !== 0 ? 'client budget + carryover' : 'client budget'}
        />
        <MetricBox
          label="Total Allocated"
          value={fmt(totalAlloc)}
          sub="actual spend"
          color={
            allocPct != null
              ? allocPct > 105
                ? COLORS.error
                : allocPct >= 95
                  ? COLORS.success
                  : COLORS.warn
              : color
          }
        />
        {goal != null && (
          <MetricBox
            label="Remaining Budget"
            value={fmt(Math.abs(remaining ?? 0))}
            sub={remaining != null && remaining < 0 ? 'over budget' : 'unallocated'}
            color={remaining != null && remaining < 0 ? COLORS.error : COLORS.success}
          />
        )}
      </div>

      {/* Allocation bar — shows only this pool's portion of each ad's
          allocation. For split ads, that's `splitBaseAmount` (Base card)
          or `allocation − splitBaseAmount` (Added card), so a single
          $192.50 split ad with $92.50 to base appears as $92.50 on the
          Base card and $100.00 on the Added card. */}
      {goal != null && goal > 0 && (() => {
        const budgetCap = goal * effMarkup;
        const poolEntries = srcAds
          .map((a, i) => {
            const c = adContribution(a);
            const portion = source === 'base' ? c.baseAllocation : c.addedAllocation;
            return { ad: a, portion, colorIdx: i };
          })
          .filter((e) => e.portion > 0);
        return (
          <>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocation
              </span>
              <span
                className="text-[10px] font-bold"
                style={{ color: statusColor }}
              >
                {allocPct != null ? `${allocPct.toFixed(1)}%` : ''}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-[var(--muted)] flex mb-2">
              {poolEntries.map(({ ad, portion, colorIdx }) => {
                const w = budgetCap > 0 ? Math.min((portion / budgetCap) * 100, 100) : 0;
                const pct = budgetCap > 0 ? (portion / budgetCap) * 100 : 0;
                const isSplit = ad.budgetSource === 'split';
                return w > 0 ? (
                  <div
                    key={ad.id}
                    title={`${ad.name || 'Untitled Ad'}${isSplit ? ` (split — ${source} portion)` : ''}: ${fmt(portion)} (${pct.toFixed(1)}% of budget)`}
                    className="h-full transition-[width] duration-500"
                    style={{
                      width: `${w}%`,
                      background: AD_COLORS[colorIdx % AD_COLORS.length],
                      borderRight: '1px solid var(--background)',
                    }}
                  />
                ) : null;
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {poolEntries.map(({ ad, portion, colorIdx }) => {
                const pct = budgetCap > 0 ? (portion / budgetCap) * 100 : 0;
                const isSplit = ad.budgetSource === 'split';
                return (
                  <div
                    key={ad.id}
                    className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]"
                    title={`${pct.toFixed(1)}% of budget${isSplit ? ' (split portion)' : ''}`}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                      style={{ background: AD_COLORS[colorIdx % AD_COLORS.length] }}
                    />
                    <span className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--foreground)]">
                      {ad.name || 'Untitled Ad'}
                      {isSplit && (
                        <span className="text-[var(--muted-foreground)] ml-0.5">·split</span>
                      )}
                    </span>
                    <span>{fmt(portion)}</span>
                    <span className="text-[var(--muted-foreground)]">
                      ({pct.toFixed(1)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ─── Total Account Allocation header ───────────────────────────────────────
function TotalAllocationHeader({ plan }: { plan: PacerPlan }) {
  // Walk every ad once and sum via adContribution so split ads add to
  // both pool totals proportionally.
  const { totalBase, totalAdded } = plan.ads.reduce(
    (acc, a) => {
      const c = adContribution(a);
      acc.totalBase += c.baseAllocation;
      acc.totalAdded += c.addedAllocation;
      return acc;
    },
    { totalBase: 0, totalAdded: 0 },
  );
  const totalActual = totalBase + totalAdded;
  if (totalActual === 0) return null;
  // Match BudgetPanel exactly so the total bar agrees with the per-source
  // cards: per-account markup, and carryover folded into each source's spend
  // target (target = goal × markup + carryover). The total budget is the SUM of
  // the two cards' targets — applying an over/under carryover therefore grows
  // the total allocation cap the same way it grows the source card it lands in.
  const effMarkup = effMarkupOf(plan.markup);
  const totalGross = Math.round((totalActual / effMarkup) * 100) / 100;
  const baseGoal = num(plan.baseBudgetGoal);
  const addedGoal = num(plan.addedBudgetGoal);
  const baseCarry = num(plan.baseCarryover) ?? 0;
  const addedCarry = num(plan.addedCarryover) ?? 0;
  const baseTarget = baseGoal != null ? baseGoal * effMarkup + baseCarry : null;
  const addedTarget = addedGoal != null ? addedGoal * effMarkup + addedCarry : null;
  const combinedActualBudget =
    baseTarget != null || addedTarget != null
      ? Math.round(((baseTarget ?? 0) + (addedTarget ?? 0)) * 100) / 100
      : null;
  const allocPct =
    combinedActualBudget != null && combinedActualBudget > 0
      ? (totalActual / combinedActualBudget) * 100
      : null;
  const pctColor =
    allocPct == null
      ? 'var(--muted-foreground)'
      : allocPct > 105
        ? COLORS.error
        : allocPct >= 95
          ? COLORS.success
          : COLORS.warn;
  // Bar widths are computed against the COMBINED budget cap so partial
  // allocation visually leaves empty space (matching the per-source bars
  // inside BudgetPanel). Falls back to share-of-total when there's no
  // budget goal set yet so the bar still has something to render.
  const widthDenominator =
    combinedActualBudget != null && combinedActualBudget > 0
      ? combinedActualBudget
      : totalActual;
  const baseW = widthDenominator > 0
    ? Math.min(100, (totalBase / widthDenominator) * 100)
    : 0;
  const addedW = widthDenominator > 0
    ? Math.min(100 - baseW, (totalAdded / widthDenominator) * 100)
    : 0;
  // Percent of total budget — used for the legend %.
  const basePctOfBudget = widthDenominator > 0
    ? (totalBase / widthDenominator) * 100
    : 0;
  const addedPctOfBudget = widthDenominator > 0
    ? (totalAdded / widthDenominator) * 100
    : 0;

  return (
    <div className="glass-section-card rounded-xl px-5 py-4 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2.5">
        <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
          Total Account Allocation
        </span>
        <div className="flex gap-3 flex-wrap">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Total Gross
            </div>
            <div className="text-base font-bold text-[var(--foreground)]">
              {fmt(totalGross)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Total Actual Spend
            </div>
            <div className="text-base font-bold text-[var(--foreground)]">
              {fmt(totalActual)}
            </div>
          </div>
          {allocPct != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocated
              </div>
              <div className="text-base font-bold" style={{ color: pctColor }}>
                {allocPct.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-[var(--muted)] flex mb-2">
        {baseW > 0 && (
          <div
            className="h-full transition-[width] duration-500"
            title={`Base: ${fmt(totalBase)} (${basePctOfBudget.toFixed(1)}% of budget)`}
            style={{
              width: `${baseW}%`,
              background: `linear-gradient(90deg, rgba(56,189,248,0.4), ${COLORS.base})`,
              borderRight: addedW > 0 ? '1px solid var(--background)' : 'none',
            }}
          />
        )}
        {addedW > 0 && (
          <div
            className="h-full transition-[width] duration-500"
            title={`Added: ${fmt(totalAdded)} (${addedPctOfBudget.toFixed(1)}% of budget)`}
            style={{
              width: `${addedW}%`,
              background: `linear-gradient(90deg, rgba(52,211,153,0.4), ${COLORS.added})`,
            }}
          />
        )}
      </div>
      <div className="flex gap-4 flex-wrap">
        {totalBase > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: COLORS.base }}
            />
            <span>Base</span>
            <span className="font-bold" style={{ color: COLORS.base }}>
              {fmt(totalBase)}
            </span>
            <span>({basePctOfBudget.toFixed(1)}%)</span>
          </div>
        )}
        {totalAdded > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: COLORS.added }}
            />
            <span>Added</span>
            <span className="font-bold" style={{ color: COLORS.added }}>
              {fmt(totalAdded)}
            </span>
            <span>({addedPctOfBudget.toFixed(1)}%)</span>
          </div>
        )}
        {combinedActualBudget != null && (
          <div className="text-[10px] text-[var(--muted-foreground)] ml-auto">
            of {fmt(combinedActualBudget)} actual spend budget
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty period state ────────────────────────────────────────────────────
function EmptyPeriodState({
  period,
  periodSummaries,
  onAddAd,
  onOpenCopy,
}: {
  period: string;
  periodSummaries: PeriodSummary[];
  onAddAd: () => void;
  onOpenCopy: () => void;
}) {
  const readOnly = usePacerReadOnly();
  const hasSources = periodSummaries.some(
    (p) => p.period !== period && p.adCount > 0,
  );
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center mb-3">
      <ClipboardDocumentListIcon className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)]" />
      <p className="text-sm text-[var(--foreground)] font-medium mb-1">
        No ads planned for {fmtPeriodLong(period)} yet.
      </p>
      <p className="text-xs text-[var(--muted-foreground)] mb-5">
        {readOnly
          ? 'This month is frozen — reopen it to add ads.'
          : 'Start fresh, or copy ads from a previous month.'}
      </p>
      {!readOnly && (
        <div className="flex flex-wrap gap-2 justify-center items-center">
          <button
            type="button"
            onClick={onAddAd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add first ad
          </button>
          {hasSources && (
            <button
              type="button"
              onClick={onOpenCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <DocumentDuplicateIcon className="w-3.5 h-3.5" />
              Copy from another month
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add Plan dropdown + Copy modal ────────────────────────────────────────
function AddPlanButton({
  onCreateNew,
  onOpenCopy,
  hasOtherPeriods,
}: {
  onCreateNew: () => void;
  onOpenCopy: () => void;
  hasOtherPeriods: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--primary)] transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add Plan
        <ChevronDownIcon className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-2xl py-1 z-30"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateNew();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] transition-colors"
          >
            <PlusIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[var(--foreground)]">
                Create a new plan
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                Start with a blank ad
              </div>
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasOtherPeriods}
            onClick={() => {
              setOpen(false);
              onOpenCopy();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <DocumentDuplicateIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[var(--foreground)]">
                Copy plan from another month
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {hasOtherPeriods
                  ? 'Pick ads to bring into this month'
                  : 'No other months with ads yet'}
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

interface CopySourceAd {
  id: string;
  name: string;
  budgetType: string;
  budgetSource: 'base' | 'added' | 'split';
  flightStart: string | null;
  flightEnd: string | null;
}

// Which groups of fields a copy carries over (Change: copy options). Ad
// identity — name, budget type, budget source, recurring, co-op, action — is
// always copied; these are the optional extras.
interface CopyFieldOptions {
  assignments: boolean; // owner / designer / account rep
  statuses: boolean; // ad + design status
  approvals: boolean; // internal + client approval
  dates: boolean; // flight start/end, live, due, creative due
  budgets: boolean; // allocation, split base, daily budget
  creative: boolean; // creative link, client name, digital details
}
const DEFAULT_COPY_FIELDS: CopyFieldOptions = {
  assignments: true,
  statuses: true,
  approvals: true,
  dates: false,
  budgets: false,
  creative: true,
};
const COPY_FIELD_LABELS: { key: keyof CopyFieldOptions; label: string; hint: string }[] = [
  { key: 'assignments', label: 'Assignments', hint: 'Owner, designer, rep' },
  { key: 'statuses', label: 'Statuses', hint: 'Ad + design status' },
  { key: 'approvals', label: 'Approvals', hint: 'Internal + client' },
  { key: 'creative', label: 'Creative & notes', hint: 'Link, client, details' },
  { key: 'dates', label: 'Flight dates', hint: 'Start/end, live, due' },
  { key: 'budgets', label: 'Budget amounts', hint: 'Allocation, daily, split' },
];

function CopyPlanModal({
  accountKey,
  targetPeriod,
  periods,
  onClose,
  onCopy,
}: {
  accountKey: string;
  targetPeriod: string;
  periods: PeriodSummary[];
  onClose: () => void;
  onCopy: (
    from: string,
    adIds: string[],
    fields: CopyFieldOptions,
  ) => Promise<void>;
}) {
  const sources = useMemo(
    () => periods.filter((p) => p.period !== targetPeriod && p.adCount > 0),
    [periods, targetPeriod],
  );
  const [sourcePeriod, setSourcePeriod] = useState<string>(
    sources[0]?.period ?? '',
  );
  const [ads, setAds] = useState<CopySourceAd[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [fields, setFields] = useState<CopyFieldOptions>(DEFAULT_COPY_FIELDS);

  useEffect(() => {
    if (!sourcePeriod) {
      setAds([]);
      return;
    }
    let cancelled = false;
    setAds(null);
    setLoadError(null);
    setSelected(new Set());
    fetch(`/api/meta-ads-pacer/${accountKey}?period=${sourcePeriod}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ ads: CopySourceAd[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.ads) ? data.ads : [];
        setAds(list);
        // Pre-select all so the common "copy everything" path is one click
        setSelected(new Set(list.map((a) => a.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, sourcePeriod]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allSelected = ads != null && ads.length > 0 && selected.size === ads.length;

  const toggleAll = () => {
    if (!ads) return;
    setSelected(allSelected ? new Set() : new Set(ads.map((a) => a.id)));
  };
  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCopy = async () => {
    if (selected.size === 0 || !sourcePeriod) return;
    setCopying(true);
    try {
      await onCopy(sourcePeriod, Array.from(selected), fields);
      onClose();
    } catch {
      // error surfaced via parent's save status
      setCopying(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-16 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-lg rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Copy ads to {fmtPeriodLong(targetPeriod)}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Ad name and budget type/source always copy. Choose what else to
              carry over below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Copy from
          </label>
          <select
            value={sourcePeriod}
            onChange={(e) => setSourcePeriod(e.target.value)}
            className={inputClass}
          >
            {sources.map((p) => (
              <option key={p.period} value={p.period}>
                {fmtPeriodLong(p.period)} — {p.adCount} ad
                {p.adCount !== 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              Pick ads to copy
            </span>
            {ads && ads.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] text-[var(--primary)] hover:underline"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {loadError ? (
              <div className="px-3 py-6 text-center text-xs text-red-400">
                {loadError}
              </div>
            ) : ads == null ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                Loading ads…
              </div>
            ) : ads.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                That month has no ads.
              </div>
            ) : (
              ads.map((ad) => {
                const checked = selected.has(ad.id);
                return (
                  <label
                    key={ad.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--muted)]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(ad.id)}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--foreground)] truncate">
                        {ad.name || 'Untitled Ad'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-2">
                        <span>{ad.budgetType}</span>
                        <span>·</span>
                        <span>
                          {sourceLabel(ad.budgetSource)}
                        </span>
                        {ad.flightStart && ad.flightEnd && (
                          <>
                            <span>·</span>
                            <span>
                              {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* What to carry over — defaults match the old behavior (identity +
            statuses/approvals/assignments/creative on; dates + budgets off). */}
        <div className="mb-4">
          <span className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Carry over
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {COPY_FIELD_LABELS.map(({ key, label, hint }) => (
              <label
                key={key}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, [key]: e.target.checked }))
                  }
                  className="w-4 h-4 mt-0.5 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--foreground)]">
                    {label}
                  </span>
                  <span className="block text-[10px] text-[var(--muted-foreground)]">
                    {hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={selected.size === 0 || copying}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
          >
            {copying
              ? 'Copying…'
              : `Copy ${selected.size} ad${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Budget Calculator modal ───────────────────────────────────────────────
/**
 * Per-source budget calculator: spreads a total budget across the source's
 * ads using one of three modes per row — "Distribute evenly" (default,
 * unlocked), "Set amount" (locked $), or "Set %" (locked % of total). The
 * unlocked ads share whatever's left after locked rows. For Daily ads the
 * computed allocation is also shown as a daily rate over the flight days.
 *
 * On Apply: writes the computed allocation back to each ad's `allocation`
 * field. If any ad in the source already has an allocation, prompts before
 * overwriting.
 */
type AllocationMode = 'even' | 'amount' | 'percent' | 'off' | 'client';

interface AdAllocSpec {
  mode: AllocationMode;
  amount: string; // when mode === 'amount'
  percent: string; // when mode === 'percent'
  // when mode === 'client': the gross/billable amount the user types.
  // computeAllocations multiplies it by the effective markup to produce
  // the actual-spend value written on Apply.
  clientAmount: string;
  included: boolean; // when false the row is ignored — its current allocation stays put
}

const DEFAULT_SPEC: AdAllocSpec = {
  mode: 'even',
  amount: '',
  percent: '',
  clientAmount: '',
  included: true,
};

/**
 * Builds the per-ad allocation map for the Budget Calculator.
 *
 * Priority order per row:
 *   1. Status "Off" / "Completed Run" → locked; allocation snaps to
 *      `pacerActual` (the Pacer page's tracked spend). Its unspent
 *      portion (alloc − pacerActual) feeds the redistribution pool.
 *   2. Mode "off" → same lock behavior (explicit user choice).
 *   3. Mode "amount" → explicit actual-spend dollar value.
 *   4. Mode "client" → gross/billable dollars × `markup` = actual spend.
 *      Used when the rep is given a client-facing number instead of the
 *      internal actual-spend number.
 *   5. Mode "percent" → percentage of `pool`. In mid-flight the pool is
 *      Remaining-to-Split (Initial − Locked Spend − Excluded Preserved);
 *      in setup mode the pool is just the Total Budget.
 *   6. Mode "even" → skipped here; user must click Spread to convert it
 *      to amount mode at that moment.
 * Excluded rows (`included === false`) are left out entirely — the parent
 * preserves their existing allocation on Apply.
 */
/**
 * Split `total` dollars into `n` parts that sum back to `total` EXACTLY to the
 * cent (12a). Equal shares, with leftover cents handed to the first rows — so
 * "distribute evenly" never leaves a phantom remainder from rounding each row
 * independently. Operates in integer cents; rounds only at the very end.
 */
function splitToCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.trunc(cents / n);
  let remainder = cents - base * n; // 0..n-1 leftover cents
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (base + extra) / 100;
  });
}

function computeAllocations(
  ads: PacerAd[],
  pool: number,
  markup: number,
  specs: Record<string, AdAllocSpec>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included) continue;

    const statusDonor =
      ad.adStatus === 'Off' || ad.adStatus === 'Completed Run';
    if (statusDonor) {
      out[ad.id] = num(ad.pacerActual) ?? 0;
      continue;
    }

    if (spec.mode === 'off') {
      out[ad.id] = num(ad.pacerActual) ?? 0;
    } else if (spec.mode === 'amount') {
      out[ad.id] = num(spec.amount) ?? 0;
    } else if (spec.mode === 'client') {
      const gross = num(spec.clientAmount) ?? 0;
      out[ad.id] = gross * markup;
    } else if (spec.mode === 'percent') {
      const pct = num(spec.percent) ?? 0;
      out[ad.id] = (pool * pct) / 100;
    }
    // even mode: skipped — user must click Spread to assign values.
  }
  return out;
}

function BudgetCalculatorModal({
  plan,
  onClose,
  onApply,
}: {
  plan: PacerPlan;
  onClose: () => void;
  onApply: (
    updates: Record<string, { allocation: number; splitBaseAmount?: number }>,
  ) => void;
}) {
  const [source, setSource] = useState<'base' | 'added'>('base');
  // Setup = fresh planning (clean slate, no spent column).
  // Mid-flight = adjusting allocations after some spend has happened (shows
  // spent per row, exposes "Off — lock at spent" to wind ads down and free
  // their remaining budget for the rest).
  const [calcMode, setCalcMode] = useState<'setup' | 'midflight'>('setup');

  // Split ads draw from BOTH pools (12b), so they appear in each source view
  // editing only that source's portion. We project a split ad to a pseudo-ad
  // with a SOURCE-QUALIFIED id ("<id>::base" / "<id>::added") whose allocation
  // and pacerActual are that source's portion — so every keyed-by-id helper,
  // spec, and row below works unchanged, and the two portions stay independent
  // across the source toggle. handleApply maps the qualified ids back.
  const sourceAds = useMemo(() => {
    const single = plan.ads.filter((a) => a.budgetSource === source);
    const split = plan.ads
      .filter((a) => a.budgetSource === 'split')
      .map((a) => {
        const c = adContribution(a);
        return {
          ...a,
          id: `${a.id}::${source}`,
          allocation: String(
            source === 'base' ? c.baseAllocation : c.addedAllocation,
          ),
          pacerActual: String(
            source === 'base' ? c.baseSpent : c.addedSpent,
          ),
        };
      });
    return [...single, ...split];
  }, [plan.ads, source]);
  // Effective markup — per-account override (Account.markup) when set,
  // otherwise the global default. Used here to convert the gross client
  // goal into the actual-spend default, and below for Client Budget mode.
  const effectiveMarkup = effMarkupOf(plan.markup);
  const goal =
    source === 'base' ? num(plan.baseBudgetGoal) : num(plan.addedBudgetGoal);
  const defaultBudget =
    goal != null ? Math.round(goal * effectiveMarkup * 100) / 100 : 0;

  // Total budget is fixed to the source's actual-spend goal (client budget ×
  // markup) — not editable; shown read-only next to the tabs.
  const totalBudget = defaultBudget;

  // (Per-row "Already Spent" inputs live on each AdAllocSpec; the pool
  // total is summed below in `totalSpent`.)

  // Per-ad allocation specs, keyed by ad id.
  // * Setup mode: pre-fill existing allocations in "Set amount" mode so
  //   you can edit the existing plan.
  // * Mid-flight mode: blank slate — every row defaults to even mode (no
  //   pre-fill) because you're redistributing the leftover pool, not
  //   editing the previous plan. The existing allocation per ad still
  //   shows as the "Allocated $X" carryover text in the row body.
  const seedSpecsForMode = useCallback(
    (mode: 'setup' | 'midflight'): Record<string, AdAllocSpec> => {
      // Mid-flight: blank slate — donor detection happens at compute time
      // (via adStatus), so no per-row seeding is needed here. Every row
      // defaults to even mode for receivers; donors are auto-handled by
      // computeAllocations regardless of mode.
      if (mode === 'midflight') return {};
      // Setup: pre-fill existing allocations in amount mode so the user can
      // edit the plan in place. Split ads seed BOTH source-qualified keys with
      // their respective portions, so each source view shows the right value.
      const seed: Record<string, AdAllocSpec> = {};
      const amountSpec = (amount: number): AdAllocSpec => ({
        mode: 'amount',
        amount: amount.toFixed(2),
        percent: '',
        clientAmount: '',
        included: true,
      });
      for (const ad of plan.ads) {
        if (ad.budgetSource === 'split') {
          const c = adContribution(ad);
          if (c.baseAllocation > 0) seed[`${ad.id}::base`] = amountSpec(c.baseAllocation);
          if (c.addedAllocation > 0) seed[`${ad.id}::added`] = amountSpec(c.addedAllocation);
          continue;
        }
        const existing = num(ad.allocation);
        if (existing != null && existing > 0) seed[ad.id] = amountSpec(existing);
      }
      return seed;
    },
    [plan.ads],
  );
  const [specs, setSpecs] = useState<Record<string, AdAllocSpec>>(() =>
    seedSpecsForMode(calcMode),
  );

  // Helpers — donor = ad status is Off / Completed Run (it's finalized,
  // locked at pacerActual on Apply). Receiver = anything else.
  const isDonor = (a: PacerAd) =>
    a.adStatus === 'Off' || a.adStatus === 'Completed Run';

  // Source pool summary. sourceAds already carries each split ad's per-source
  // portion (projected, qualified id), so these sums cover split ads with no
  // separate handling.
  // * Initially Allocated = source-portion allocations at modal open (the ad
  //   isn't mutated until Apply, so the live value equals the opening value).
  // * Locked Spend        = Σ pacerActual for status-locked ads (Off/Completed).
  // * Excluded Preserved  = Σ existing allocation for unchecked rows.
  // * Remaining to Split  = Mid-flight: Initial − Locked − Excluded; Setup mode:
  //   just the Total Budget.
  const initiallyAllocated = sourceAds.reduce(
    (s, a) => s + (num(a.allocation) ?? 0),
    0,
  );
  const lockedSpend =
    calcMode === 'midflight'
      ? sourceAds.reduce(
          (s, a) => (isDonor(a) ? s + (num(a.pacerActual) ?? 0) : s),
          0,
        )
      : 0;
  const excludedPreserved =
    calcMode === 'midflight'
      ? sourceAds.reduce((s, a) => {
          const spec = specs[a.id] ?? DEFAULT_SPEC;
          return spec.included ? s : s + (num(a.allocation) ?? 0);
        }, 0)
      : 0;
  const remainingToSplit =
    calcMode === 'midflight'
      ? Math.max(0, initiallyAllocated - lockedSpend - excludedPreserved)
      : totalBudget;

  // Allocations — uses remainingToSplit (not totalBudget) as the base for
  // percent-mode rows, so "Set 75%" means 75% of the redistribution pool
  // the user is actually distributing, not 75% of the gross ceiling.
  // effectiveMarkup (declared above) powers the Client Budget mode.
  const allocations = useMemo(
    () => computeAllocations(sourceAds, remainingToSplit, effectiveMarkup, specs),
    [sourceAds, remainingToSplit, effectiveMarkup, specs],
  );

  // Active-row commitments — what the user has explicitly typed for
  // receivers (amount/percent/off). Donor rows are auto-locked via
  // status and already reflected in lockedSpend. Excluded rows preserve
  // their existing allocation. Even-mode receiver rows skip here — they
  // only get a value once the user clicks Spread.
  const enteredSoFar = sourceAds.reduce((s, a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (!spec.included) return s;
    if (isDonor(a)) return s;
    const v = allocations[a.id];
    return v == null ? s : s + v;
  }, 0);
  const stillToAllocate = remainingToSplit - enteredSoFar;
  const overAllocated = stillToAllocate < -0.005;
  // overBudget reuses the same semantic as before so the existing Apply
  // guard ("can't apply when over") still kicks in.
  const overBudget = overAllocated;

  // Spread state — only included, non-donor, even-mode rows are
  // candidates for the remainder. Donors are locked at pacerActual and
  // must not be overwritten by the spread.
  const evenRowsForSpread = sourceAds.filter((a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (isDonor(a)) return false;
    return spec.included && spec.mode === 'even';
  });
  const spreadPool = Math.max(0, stillToAllocate);
  // Mid-flight mode gates Spread on there being at least one donor (an
  // ad with status Off or Completed Run that contributed to the pool).
  // Without a donor, there's nothing being freed and the pool is just
  // the existing allocations. Setup mode has no donor concept, so
  // Spread is always available there.
  const spentGateOk = calcMode !== 'midflight' || lockedSpend > 0;
  const canSpread =
    evenRowsForSpread.length > 0 && spreadPool > 0.005 && spentGateOk;
  const perEvenPreview = canSpread ? spreadPool / evenRowsForSpread.length : 0;

  const handleSpread = () => {
    if (!canSpread) return;
    // Cent-accurate shares that sum to the pool exactly — no phantom residual
    // from rounding each row independently (12a).
    const shares = splitToCents(spreadPool, evenRowsForSpread.length);
    setSpecs((prev) => {
      const next = { ...prev };
      evenRowsForSpread.forEach((ad, i) => {
        const existing = next[ad.id] ?? DEFAULT_SPEC;
        next[ad.id] = {
          ...existing,
          mode: 'amount',
          amount: shares[i].toFixed(2),
          percent: '',
          clientAmount: existing.clientAmount,
          included: true,
        };
      });
      return next;
    });
  };

  // Any included "Set amount" row whose value sits below its already-spent
  // amount blocks Apply — you can't allocate less than you've already paid.
  const hasUnderSpent = sourceAds.some((a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (!spec.included || spec.mode !== 'amount') return false;
    if (spec.amount.trim() === '') return false;
    const v = num(spec.amount) ?? 0;
    const spent = num(a.pacerActual) ?? 0;
    return v < spent - 0.005;
  });

  // Switching modes re-seeds the row state from scratch:
  // * → Setup:      restore the existing-allocation pre-fills so the user
  //                 can edit the plan.
  // * → Mid-flight: clear all pre-fills so the rows default to even mode,
  //                 ready to absorb the post-spent remainder.
  // The first mount also runs this once with `calcMode === 'setup'`, which
  // matches the useState initializer — no-op effectively.
  const didInitSpecsRef = useRef(false);
  useEffect(() => {
    if (!didInitSpecsRef.current) {
      didInitSpecsRef.current = true;
      return;
    }
    setSpecs(seedSpecsForMode(calcMode));
  }, [calcMode, seedSpecsForMode]);

  const updateSpec = (adId: string, patch: Partial<AdAllocSpec>) =>
    setSpecs((prev) => ({
      ...prev,
      [adId]: {
        mode: prev[adId]?.mode ?? 'even',
        amount: prev[adId]?.amount ?? '',
        percent: prev[adId]?.percent ?? '',
        clientAmount: prev[adId]?.clientAmount ?? '',
        included: prev[adId]?.included ?? true,
        ...patch,
      },
    }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Count of rows the Apply button will actually write to — only rows
  // with a computed allocation (amount/percent/off). Even-mode rows are
  // skipped until the user spreads them, so they don't count here.
  const includedCount = sourceAds.filter(
    (a) => allocations[a.id] != null,
  ).length;

  const handleApply = () => {
    // Only ask about overwrite for rows that will actually be written AND
    // already have an allocation. Even-mode rows are skipped on Apply.
    const adsWithExisting = sourceAds.filter((a) => {
      if (allocations[a.id] == null) return false;
      const existing = num(a.allocation);
      return existing != null && existing > 0;
    });
    if (adsWithExisting.length > 0) {
      if (
        !window.confirm(
          `${adsWithExisting.length} ad${adsWithExisting.length === 1 ? '' : 's'} in ${source === 'base' ? 'Base' : 'Added'} already ${adsWithExisting.length === 1 ? 'has' : 'have'} an allocation set. Overwrite?`,
        )
      ) {
        return;
      }
    }
    // Map computed (source-portion) values back to real ads. For a Split ad,
    // set splitBaseAmount + combined allocation, preserving the OTHER source's
    // portion that this view didn't touch.
    const updates: Record<
      string,
      { allocation: number; splitBaseAmount?: number }
    > = {};
    for (const a of sourceAds) {
      const v = allocations[a.id];
      if (v == null) continue;
      if (a.budgetSource === 'split') {
        const realId = a.id.split('::')[0];
        const orig = plan.ads.find((o) => o.id === realId);
        if (!orig) continue;
        const c = adContribution(orig);
        const base = source === 'base' ? v : c.baseAllocation;
        const added = source === 'added' ? v : c.addedAllocation;
        updates[realId] = { allocation: base + added, splitBaseAmount: base };
      } else {
        updates[a.id] = { allocation: v };
      }
    }
    onApply(updates);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-12 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-3xl rounded-xl p-5 max-h-[95vh] flex flex-col"
      >
        <div className="flex shrink-0 items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Budget Calculator
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              {calcMode === 'setup'
                ? `Plan a fresh allocation across the ${source === 'base' ? 'Base' : 'Added'} ads.`
                : `Reallocate after spending. Donors (Off / Completed Run) auto-lock at Pacer spend; their freed budget redistributes to active ads.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Mode + Source tabs — paired on one row so they don't each
            consume a full strip's worth of vertical space. */}
        <div className="flex shrink-0 items-center flex-wrap gap-2 mb-3">
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 self-start">
          {(
            [
              { key: 'setup', label: 'Initial Setup' },
              { key: 'midflight', label: 'Mid-flight Reallocation' },
            ] as const
          ).map((m) => {
            const active = calcMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setCalcMode(m.key)}
                className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                  active
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Source tabs (Base / Added) — sit on the same row as Mode
            tabs to save vertical space. Active fill uses each source's
            accent color (Base = blue, Added = green). */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 self-start">
          {(['base', 'added'] as const).map((s) => {
            const active = source === s;
            const count = plan.ads.filter((a) => a.budgetSource === s).length;
            const accent = s === 'base' ? COLORS.base : COLORS.added;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
                style={active ? { background: accent } : undefined}
              >
                {s === 'base' ? 'Base' : 'Added'} ({count})
              </button>
            );
          })}
        </div>

        {/* Total budget — fixed to the source's goal (client × markup), shown
            read-only on the right of the tabs. */}
        <div
          className="ml-auto self-center text-right"
          title="Client budget goal × margin for this source"
        >
          <span className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] leading-none">
            Total Budget
          </span>
          <span className="block text-base font-bold tabular-nums text-[var(--foreground)] leading-tight">
            {fmt(totalBudget)}
          </span>
        </div>
        </div>

        {/* Compact stat strip — Mid-flight: 5 cells (Initial, Locked Spend,
            Remaining, Entered, Still). Setup: 2 cells (Entered, Still). */}
        <div
          className={`grid shrink-0 gap-px mb-3 rounded-lg bg-[var(--border)] overflow-hidden ${
            calcMode === 'midflight'
              ? 'grid-cols-2 md:grid-cols-5'
              : 'grid-cols-2'
          }`}
        >
          {calcMode === 'midflight' && (
            <>
              <CompactStat
                label="Initial"
                value={fmt(initiallyAllocated)}
                title={`${sourceAds.length} ${source === 'base' ? 'Base' : 'Added'} ad${sourceAds.length === 1 ? '' : 's'}`}
              />
              <CompactStat
                label="Locked Spend"
                value={fmt(lockedSpend)}
                title={
                  lockedSpend > 0
                    ? 'Pacer spend on Off / Completed Run ads (locked at this value on Apply)'
                    : 'No locked ads yet — mark an ad Off or Completed Run'
                }
              />
              <CompactStat
                label="Remaining"
                value={fmt(remainingToSplit)}
                title={
                  excludedPreserved > 0
                    ? `${fmt(initiallyAllocated)} − ${fmt(lockedSpend)} locked − ${fmt(excludedPreserved)} preserved`
                    : lockedSpend > 0
                      ? `${fmt(initiallyAllocated)} − ${fmt(lockedSpend)} locked`
                      : 'Nothing freed yet'
                }
              />
            </>
          )}
          <CompactStat
            label="Entered"
            value={fmt(enteredSoFar)}
            title={`Out of ${fmt(remainingToSplit)} to split`}
            color={
              overAllocated
                ? COLORS.error
                : stillToAllocate < 0.005
                  ? COLORS.success
                  : COLORS.warn
            }
          />
          <CompactStat
            label={overAllocated ? 'Over' : 'Unallocated'}
            value={fmt(Math.abs(stillToAllocate))}
            title={
              overAllocated
                ? 'Reduce locked rows or raise total'
                : stillToAllocate < 0.005
                  ? 'Fully allocated'
                  : evenRowsForSpread.length > 0
                    ? `${evenRowsForSpread.length} row${evenRowsForSpread.length === 1 ? '' : 's'} waiting for Spread`
                    : 'Not assigned to any ad'
            }
            color={overAllocated ? COLORS.error : undefined}
          />
        </div>

        {/* Spread button — only shows when there's a positive remainder
            AND at least one included even-mode row to absorb it. Click
            converts those rows to amount mode at the computed per-row
            share. No auto-recalc afterward. */}
        {canSpread && (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5 mb-2">
            <div className="text-[11px] text-[var(--muted-foreground)] min-w-0 truncate">
              <span className="font-semibold text-[var(--foreground)]">
                {fmt(spreadPool)}
              </span>{' '}
              across{' '}
              <span className="font-semibold text-[var(--foreground)]">
                {evenRowsForSpread.length}
              </span>{' '}
              row{evenRowsForSpread.length === 1 ? '' : 's'} ={' '}
              <span className="font-semibold text-[var(--foreground)]">
                {fmt(perEvenPreview)}
              </span>{' '}
              each
            </div>
            <button
              type="button"
              onClick={handleSpread}
              className="px-3 py-1 text-[11px] font-semibold rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors whitespace-nowrap"
            >
              Spread remainder
            </button>
          </div>
        )}

        {/* Ad list */}
        <div className="themed-scrollbar overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {sourceAds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center text-xs text-[var(--muted-foreground)]">
              No {source === 'base' ? 'Base' : 'Added'} ads in this period yet.
            </div>
          ) : (
            <div className="space-y-2">
              {sourceAds.map((ad) => {
                const spec = specs[ad.id] ?? DEFAULT_SPEC;
                const allocated = allocations[ad.id] ?? 0;
                const currentAllocation = num(ad.allocation) ?? 0;
                const currentSpent = num(ad.pacerActual) ?? 0;
                const flightDays =
                  ad.flightStart && ad.flightEnd
                    ? calcDays(ad.flightStart, ad.flightEnd)
                    : 0;
                const dailyRate =
                  ad.budgetType === 'Daily' && flightDays > 0
                    ? allocated / flightDays
                    : null;
                // Donor rows are auto-handled (status Off / Completed Run) —
                // their allocation locks at pacerActual and is excluded from
                // "Entered" in BOTH modes (computeAllocations / enteredSoFar
                // aren't mode-gated). So lock + label the row in Setup too,
                // matching mid-flight, instead of showing an editable control
                // that's silently ignored.
                const adIsDonor =
                  ad.adStatus === 'Off' || ad.adStatus === 'Completed Run';
                // Block applying an allocation below what's already been spent;
                // the input flag turns red and the modal-level Apply disables.
                const underSpent =
                  spec.included &&
                  spec.mode === 'amount' &&
                  spec.amount.trim() !== '' &&
                  (num(spec.amount) ?? 0) < currentSpent - 0.005;
                return (
                  <div
                    key={ad.id}
                    className={`grid grid-cols-1 md:grid-cols-[28px_1fr_140px_140px_140px] gap-2 items-center rounded-lg border bg-[var(--card)] px-3 py-2 ${
                      spec.included
                        ? 'border-[var(--border)]'
                        : 'border-[var(--border)] opacity-60'
                    }`}
                  >
                    <label
                      className="flex items-center justify-center cursor-pointer"
                      title={
                        spec.included
                          ? 'Uncheck to leave this ad untouched on Apply'
                          : 'This ad keeps its current allocation on Apply'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={spec.included}
                        onChange={(e) =>
                          updateSpec(ad.id, { included: e.target.checked })
                        }
                        className="w-4 h-4 accent-[var(--primary)]"
                      />
                    </label>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--foreground)] truncate">
                        {ad.name || 'Untitled Ad'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {ad.budgetType}
                        {flightDays > 0 ? ` · ${flightDays} days` : ''}
                        {ad.budgetSource === 'split' && (
                          <span style={{ color: sourceColor('split') }}>
                            {' '}· Split ({source === 'base' ? 'Base' : 'Added'}{' '}
                            portion)
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        {currentAllocation > 0 ? (
                          <>
                            Allocated{' '}
                            <span className="font-semibold">
                              {fmt(currentAllocation)}
                            </span>
                          </>
                        ) : (
                          <span className="italic">no allocation yet</span>
                        )}
                      </div>
                      {calcMode === 'midflight' && (
                        <div className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
                          Spent{' '}
                          <span className="font-semibold text-[var(--foreground)] tabular-nums">
                            {fmt(currentSpent)}
                          </span>
                          <span className="ml-1 italic">(from Pacer)</span>
                        </div>
                      )}
                    </div>
                    {adIsDonor ? (
                      <div
                        className="flex items-center gap-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--muted)]/60 text-[11px] text-[var(--muted-foreground)]"
                        title={`Locked — status is ${ad.adStatus}. Allocation locks at Pacer spend on Apply.`}
                      >
                        <LockClosedIcon className="w-3 h-3 flex-shrink-0" />
                        <span>Locked</span>
                      </div>
                    ) : (
                      <select
                        value={spec.mode}
                        disabled={!spec.included}
                        onChange={(e) =>
                          updateSpec(ad.id, {
                            mode: e.target.value as AllocationMode,
                          })
                        }
                        className={`${inputClass} text-[11px] py-1.5 disabled:opacity-50`}
                      >
                        <option value="even">Distribute evenly</option>
                        <option value="amount">Set amount</option>
                        <option value="client">Client Budget (gross)</option>
                        <option value="percent">Set %</option>
                        {calcMode === 'midflight' && (
                          <option value="off">Off — lock at spent</option>
                        )}
                      </select>
                    )}
                    <div>
                      {adIsDonor ? (
                        <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                          {fmt(currentSpent)} locked
                        </div>
                      ) : (
                        <>
                          {spec.included && spec.mode === 'amount' && (
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <DollarInput
                                  value={spec.amount}
                                  onChange={(v) => updateSpec(ad.id, { amount: v })}
                                  placeholder="0.00"
                                />
                              </div>
                              {underSpent && (
                                <Tooltip
                                  label={`Below ${fmt(currentSpent)} already spent`}
                                >
                                  <ExclamationTriangleIcon
                                    className="w-4 h-4 flex-shrink-0"
                                    style={{ color: COLORS.error }}
                                  />
                                </Tooltip>
                              )}
                            </div>
                          )}
                          {spec.included && spec.mode === 'percent' && (
                            <div className="relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={spec.percent}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '' || /^\d*\.?\d*$/.test(v)) {
                                    updateSpec(ad.id, { percent: v });
                                  }
                                }}
                                placeholder="0"
                                className={`${inputClass} pr-7`}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)] pointer-events-none">
                                %
                              </span>
                            </div>
                          )}
                          {spec.included && spec.mode === 'client' && (
                            <div>
                              <DollarInput
                                value={spec.clientAmount}
                                onChange={(v) =>
                                  updateSpec(ad.id, { clientAmount: v ?? '' })
                                }
                                placeholder="0.00"
                              />
                              {spec.clientAmount.trim() !== '' && (
                                <p className="text-[10px] mt-0.5 text-[var(--muted-foreground)]">
                                  × {effectiveMarkup} ={' '}
                                  <span className="font-semibold text-[var(--foreground)]">
                                    {fmt(
                                      (num(spec.clientAmount) ?? 0) *
                                        effectiveMarkup,
                                    )}
                                  </span>{' '}
                                  actual
                                </p>
                              )}
                            </div>
                          )}
                          {spec.included && spec.mode === 'even' && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              waiting for Spread
                            </div>
                          )}
                          {spec.included && spec.mode === 'off' && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              locked at {fmt(currentSpent)}
                            </div>
                          )}
                          {!spec.included && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              left as-is
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {adIsDonor && spec.included ? (
                      <div className="text-right">
                        <div
                          className="text-sm font-bold"
                          style={{ color: COLORS.success }}
                        >
                          {fmt(currentAllocation - currentSpent)}
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          available
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div
                          className="text-sm font-bold"
                          style={{
                            color:
                              !spec.included || spec.mode === 'even'
                                ? 'var(--muted-foreground)'
                                : sourceColor(ad.budgetSource),
                          }}
                        >
                          {!spec.included
                            ? fmt(currentAllocation)
                            : spec.mode === 'even'
                              ? '—'
                              : fmt(allocated)}
                        </div>
                        {dailyRate != null && spec.included && (
                          <div className="text-[10px] text-[var(--muted-foreground)]">
                            {fmt(dailyRate)}/day · {flightDays}d
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={includedCount === 0 || overBudget || hasUnderSpent}
            title={
              hasUnderSpent
                ? 'One or more amounts are below the already-spent value'
                : overBudget
                  ? 'Allocations exceed the total budget'
                  : undefined
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
          >
            Apply to {includedCount} ad{includedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Ad Planner panel ──────────────────────────────────────────────────────
type EditorState =
  | { mode: 'create'; draft: PacerAd }
  | { mode: 'edit'; adId: string; original: PacerAd };

function AdPlannerPanel({
  plan,
  period,
  users,
  filters,
  onFiltersChange,
  currentUserId,
  periodSummaries,
  onChange,
  onCopyFrom,
  onModalOpenChange,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
}: {
  plan: PacerPlan;
  period: string;
  users: DirectoryUser[];
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  currentUserId: string | null;
  periodSummaries: PeriodSummary[];
  onChange: (p: PacerPlan) => void;
  onCopyFrom: (
    from: string,
    adIds: string[] | undefined,
    fields: CopyFieldOptions,
  ) => Promise<void> | void;
  onModalOpenChange?: (open: boolean) => void;
  onAddActivity: (adId: string, text: string, file: File | null) => Promise<void>;
  onEditActivity: (adId: string, entryId: string, text: string) => Promise<void>;
  onDeleteActivity: (adId: string, entryId: string) => Promise<void>;
}) {
  const readOnly = usePacerReadOnly();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showCalcModal, setShowCalcModal] = useState(false);

  const handleReorder = (nextAds: PacerAd[]) => {
    if (readOnly) return; // frozen month — reorder is a no-op
    onChange({ ...plan, ads: nextAds });
  };
  const drag = useDragReorder(plan.ads, handleReorder);

  // Notify parent so it can pause autosave while a modal owns the in-flight edits.
  useEffect(() => {
    onModalOpenChange?.(editor !== null);
  }, [editor, onModalOpenChange]);

  // Always-current ref to the plan so the soft-delete undo callback can
  // splice into the latest state even if the user kept editing after the
  // delete fired.
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const removeAd = (id: string) => {
    if (readOnly) return; // frozen month — deletion is disabled
    const idx = plan.ads.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const removed = plan.ads[idx];
    onChange({ ...plan, ads: plan.ads.filter((a) => a.id !== id) });
    if (editor?.mode === 'edit' && editor.adId === id) setEditor(null);

    // Soft-delete UX: surface an undo affordance via a sonner toast that
    // reinserts the ad at its original index. The autosave debounce fires
    // again on undo to re-persist the row.
    toast.success(`Removed "${removed.name || 'Untitled Ad'}"`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          const current = planRef.current;
          // Bail if the row somehow already exists (shouldn't, but guard
          // against double-undo race).
          if (current.ads.some((a) => a.id === removed.id)) return;
          const next = [...current.ads];
          const insertAt = Math.min(idx, next.length);
          next.splice(insertAt, 0, removed);
          onChange({ ...current, ads: next });
        },
      },
    });
  };
  const openCreate = () => {
    const fresh = makeAd(plan.ads.length, period);
    setEditor({ mode: 'create', draft: fresh });
  };
  const openEdit = (id: string) => {
    const original = plan.ads.find((a) => a.id === id);
    if (!original) return;
    setEditor({ mode: 'edit', adId: id, original });
  };
  const cloneAd = (id: string) => {
    const src = plan.ads.find((a) => a.id === id);
    if (!src) return;
    const cloneName = `${src.name || 'Ad'} (copy)`;
    const cloned: PacerAd = {
      ...src,
      id: newAdId(),
      position: plan.ads.length,
      name: cloneName,
      // Dates reset — a fresh copy shouldn't inherit the source's schedule
      flightStart: null,
      flightEnd: null,
      liveDate: null,
      creativeDueDate: null,
      dueDate: null,
      dateCompleted: null,
      // Budget + pacer fields reset — start blank so we don't apply stale spend
      allocation: null,
      pacerActual: null,
      pacerDailyBudget: null,
      pacerTodayDate: null,
      pacerEndDate: null,
      // Facebook link reset — a copy must not inherit the source's campaign
      // mapping, or both rows would sync the same spend onto themselves.
      metaObjectType: null,
      metaObjectId: null,
      metaEffectiveStatus: null,
      pacerSyncedAt: null,
      // Activity log + design notes are tied to the original — start fresh
      activityLog: [],
      designNotes: [],
    };
    onChange({ ...plan, ads: [...plan.ads, cloned] });
  };

  const handleSave = (draft: PacerAd) => {
    if (!editor) return;
    if (editor.mode === 'create') {
      onChange({ ...plan, ads: [...plan.ads, draft] });
    } else {
      // Preserve the LIVE activity log from plan — the modal's draft still
      // holds the snapshot from when it opened, but updates posted while
      // editing live in plan and shouldn't be overwritten on Save.
      onChange({
        ...plan,
        ads: plan.ads.map((a) =>
          a.id === editor.adId
            ? {
                ...draft,
                activityLog: a.activityLog,
                designNotes: a.designNotes,
              }
            : a,
        ),
      });
    }
    setEditor(null);
  };

  const [search, setSearch] = useState('');
  const visibleAds = useMemo(() => {
    const filtered = applyFilters(plan.ads, filters, currentUserId);
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((a) => (a.name || '').toLowerCase().includes(q));
  }, [plan.ads, filters, currentUserId, search]);

  // ── Bulk selection ──────────────────────────────────────────────────────
  const { confirm } = useLoomiDialog();
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField | null>(null);

  // Drop selections that fall out of view (e.g., a filter hides them) so
  // bulk actions never silently affect rows the user can't see.
  useEffect(() => {
    setSelectedAdIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleAds.map((a) => a.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [visibleAds]);

  const allVisibleSelected =
    visibleAds.length > 0 && visibleAds.every((a) => selectedAdIds.has(a.id));
  const someVisibleSelected = visibleAds.some((a) => selectedAdIds.has(a.id));

  const toggleSelectAd = (id: string) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedAdIds((prev) => {
      if (visibleAds.every((a) => prev.has(a.id))) {
        const next = new Set(prev);
        visibleAds.forEach((a) => next.delete(a.id));
        return next;
      }
      const next = new Set(prev);
      visibleAds.forEach((a) => next.add(a.id));
      return next;
    });
  };
  const clearSelection = () => setSelectedAdIds(new Set());

  const handleBulkDelete = async () => {
    const n = selectedAdIds.size;
    if (n === 0) return;
    const ok = await confirm({
      title: `Delete ${n} ad${n !== 1 ? 's' : ''}?`,
      message: 'You can undo each removal individually from the toast notifications.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    // Calling removeAd(id) in a forEach loop creates N separate onChange
    // calls, each reading `plan.ads` from the stale closure — React batches
    // them and the last call wins, leaving N-1 ads still alive. Snapshot
    // the removed rows once, then do a single batched state update.
    const idSet = selectedAdIds;
    const removedItems: Array<{ ad: PacerAd; idx: number }> = [];
    plan.ads.forEach((ad, idx) => {
      if (idSet.has(ad.id)) removedItems.push({ ad, idx });
    });
    if (removedItems.length === 0) {
      clearSelection();
      return;
    }

    onChange({
      ...plan,
      ads: plan.ads.filter((a) => !idSet.has(a.id)),
    });
    if (editor?.mode === 'edit' && idSet.has(editor.adId)) setEditor(null);

    // Per-row undo toasts, same UX as single-row delete — undo uses
    // planRef.current so each one splices into the latest state.
    for (const { ad: removed, idx } of removedItems) {
      toast.success(`Removed "${removed.name || 'Untitled Ad'}"`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            const current = planRef.current;
            if (current.ads.some((a) => a.id === removed.id)) return;
            const next = [...current.ads];
            const insertAt = Math.min(idx, next.length);
            next.splice(insertAt, 0, removed);
            onChange({ ...current, ads: next });
          },
        },
      });
    }

    clearSelection();
  };

  const applyBulkPatch = (patch: Partial<PacerAd>) => {
    const n = selectedAdIds.size;
    if (n === 0) return;
    onChange({
      ...plan,
      ads: plan.ads.map((a) => (selectedAdIds.has(a.id) ? { ...a, ...patch } : a)),
    });
    toast.success(`Updated ${n} ad${n !== 1 ? 's' : ''}`);
    setBulkField(null);
    clearSelection();
  };

  const editorInitialAd: PacerAd | null =
    editor?.mode === 'create' ? editor.draft : editor?.original ?? null;

  // Re-pull the activity log from plan on every render so newly posted /
  // edited / deleted updates appear in the modal without a refresh.
  const editorLiveActivityLog: ActivityEntry[] | undefined =
    editor?.mode === 'edit'
      ? plan.ads.find((a) => a.id === editor.adId)?.activityLog
      : undefined;

  const otherPeriodsWithAds = useMemo(
    () =>
      periodSummaries.filter((p) => p.period !== period && p.adCount > 0).length >
      0,
    [periodSummaries, period],
  );

  return (
    <div>
      {/* Header row: Ad Plan label + Add Plan CTA on the right */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ClipboardDocumentListIcon className="w-4 h-4" />
          {`Ad Plan · ${fmtPeriodLong(period)} (${visibleAds.length}${
            visibleAds.length !== plan.ads.length ? ` of ${plan.ads.length}` : ''
          } ad${plan.ads.length !== 1 ? 's' : ''})`}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick search by ad name — applied on top of the active filters. */}
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ads…"
              aria-label="Search ads by name"
              className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] w-44"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCalcModal(true)}
            disabled={plan.ads.length === 0 || readOnly}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={
              readOnly
                ? 'This month is frozen'
                : 'Spread a budget evenly or with locked amounts/percentages'
            }
          >
            <CalculatorIcon className="w-3.5 h-3.5" />
            Calculator
          </button>
          {!readOnly && (
            <AddPlanButton
              onCreateNew={openCreate}
              onOpenCopy={() => setShowCopyModal(true)}
              hasOtherPeriods={otherPeriodsWithAds}
            />
          )}
        </div>
      </div>

      {plan.ads.length > 0 && (
        <FilterStatus
          filters={filters}
          onClear={() => onFiltersChange(EMPTY_FILTERS)}
          filteredCount={visibleAds.length}
          totalCount={plan.ads.length}
        />
      )}

      {plan.ads.length === 0 ? (
        <EmptyPeriodState
          period={period}
          periodSummaries={periodSummaries}
          onAddAd={openCreate}
          onOpenCopy={() => setShowCopyModal(true)}
        />
      ) : visibleAds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center text-sm text-[var(--muted-foreground)] mb-3">
          No ads match the current filters.
        </div>
      ) : (
        <div className="glass-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <th className="w-9 pl-3 pr-1 py-2">
                    <input
                      type="checkbox"
                      aria-label={
                        allVisibleSelected ? 'Deselect all ads' : 'Select all ads'
                      }
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 rounded border-[var(--border)] bg-[var(--input)] text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Ad
                  </th>
                  {/* Updates icon column — no header, just kept aligned */}
                  <th className="w-10 px-2 py-2"></th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Due
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Budget
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Allocation
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Flight
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Design
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Approvals
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleAds.map((ad) => (
                  <AdSummaryRow
                    key={ad.id}
                    ad={ad}
                    index={plan.ads.findIndex((a) => a.id === ad.id)}
                    onClick={() => openEdit(ad.id)}
                    onRemove={removeAd}
                    onClone={cloneAd}
                    dragProps={drag.rowProps(ad.id)}
                    isDragging={drag.draggedId === ad.id}
                    isDropTarget={
                      drag.dropTargetId === ad.id && drag.draggedId !== ad.id
                    }
                    dropEdge={
                      drag.dropTargetId === ad.id ? drag.dropEdge : null
                    }
                    isSelected={selectedAdIds.has(ad.id)}
                    onSelectToggle={() => toggleSelectAd(ad.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editor && editorInitialAd && (
        <AdEditorModal
          initialAd={editorInitialAd}
          markup={plan.markup}
          liveActivityLog={editorLiveActivityLog}
          mode={editor.mode}
          users={users}
          currentUserId={currentUserId}
          onSave={handleSave}
          onCancel={() => setEditor(null)}
          onAddActivity={onAddActivity}
          onEditActivity={onEditActivity}
          onDeleteActivity={onDeleteActivity}
        />
      )}

      {showCopyModal && (
        <CopyPlanModal
          accountKey={plan.accountKey}
          targetPeriod={period}
          periods={periodSummaries}
          onClose={() => setShowCopyModal(false)}
          onCopy={(from, adIds, fields) =>
            Promise.resolve(onCopyFrom(from, adIds, fields))
          }
        />
      )}

      {showCalcModal && (
        <BudgetCalculatorModal
          plan={plan}
          onClose={() => setShowCalcModal(false)}
          onApply={(updates) => {
            onChange({
              ...plan,
              ads: plan.ads.map((a) => {
                const u = updates[a.id];
                if (u == null) return a;
                return {
                  ...a,
                  allocation: u.allocation.toFixed(2),
                  ...(u.splitBaseAmount != null
                    ? { splitBaseAmount: u.splitBaseAmount.toFixed(2) }
                    : {}),
                };
              }),
            });
            setShowCalcModal(false);
          }}
        />
      )}

      {bulkField && (
        <BulkEditModal
          field={bulkField}
          count={selectedAdIds.size}
          users={users}
          onClose={() => setBulkField(null)}
          onApply={applyBulkPatch}
        />
      )}

      {selectedAdIds.size > 0 && (
        <BulkActionDock
          count={selectedAdIds.size}
          itemLabel={selectedAdIds.size === 1 ? 'ad' : 'ads'}
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: allVisibleSelected ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: toggleSelectAllVisible,
              disabled: visibleAds.length === 0,
            },
            {
              id: 'flight',
              label: 'Flight Dates',
              icon: <CalendarIcon className="h-4 w-4" />,
              onClick: () => setBulkField('flight'),
            },
            {
              id: 'budget-type',
              label: 'Budget Type',
              icon: <ChartBarIcon className="h-4 w-4" />,
              onClick: () => setBulkField('budgetType'),
            },
            {
              id: 'budget-source',
              label: 'Budget Source',
              icon: <FunnelIcon className="h-4 w-4" />,
              onClick: () => setBulkField('budgetSource'),
            },
            {
              id: 'owner',
              label: 'Owner',
              icon: <UserCircleIcon className="h-4 w-4" />,
              onClick: () => setBulkField('owner'),
            },
            {
              id: 'ad-status',
              label: 'Ad Status',
              icon: <ClockIcon className="h-4 w-4" />,
              onClick: () => setBulkField('adStatus'),
            },
            {
              id: 'design-status',
              label: 'Design Status',
              icon: <PaintBrushIcon className="h-4 w-4" />,
              onClick: () => setBulkField('designStatus'),
            },
            {
              id: 'internal-status',
              label: 'Internal Status',
              icon: <CheckBadgeIcon className="h-4 w-4" />,
              onClick: () => setBulkField('internalApproval'),
            },
            {
              id: 'client-status',
              label: 'Client Status',
              icon: <CheckBadgeIcon className="h-4 w-4" />,
              onClick: () => setBulkField('clientApproval'),
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDelete,
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
}

// ─── Bulk-edit modal ───────────────────────────────────────────────────────
type BulkField =
  | 'flight'
  | 'budgetType'
  | 'budgetSource'
  | 'owner'
  | 'adStatus'
  | 'designStatus'
  | 'internalApproval'
  | 'clientApproval';

const BULK_FIELD_LABELS: Record<BulkField, string> = {
  flight: 'Flight Dates',
  budgetType: 'Budget Type',
  budgetSource: 'Budget Source',
  owner: 'Owner',
  adStatus: 'Ad Status',
  designStatus: 'Design Status',
  internalApproval: 'Internal Status',
  clientApproval: 'Client Status',
};

// ─── Account-level notes (chat log) ────────────────────────────────────────
interface AccountNote {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
}

function AccountNotesDrawer({
  accountKey,
  accountLabel,
  period,
  users,
  currentUserId,
  onClose,
  onCountChange,
}: {
  accountKey: string;
  accountLabel: string;
  // Account comments are scoped to the month they're written in — May notes
  // only appear in May, June starts fresh.
  period: string;
  users: DirectoryUser[];
  currentUserId: string | null;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const [notes, setNotes] = useState<AccountNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const userMap = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/notes?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ notes: AccountNote[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.notes) ? data.notes : [];
        setNotes(list);
        onCountChange?.(list.length);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period, onCountChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, period }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const note = (await res.json()) as AccountNote;
      setNotes((prev) => {
        const next = [...(prev ?? []), note];
        onCountChange?.(next.length);
        return next;
      });
      setText('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] post failed', err);
      toast.error('Could not post note');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    const prev = notes ?? [];
    // Optimistic update so the row vanishes immediately; rollback on error.
    setNotes(prev.filter((n) => n.id !== noteId));
    onCountChange?.(Math.max(0, prev.length - 1));
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/notes/${noteId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] delete failed', err);
      toast.error('Could not delete note');
      setNotes(prev);
      onCountChange?.(prev.length);
    }
  };

  const startEdit = (noteId: string, currentText: string) => {
    setEditingId(noteId);
    setEditText(currentText);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = async (noteId: string) => {
    const trimmed = editText.trim();
    if (!trimmed || editSaving) return;
    setEditSaving(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/notes/${noteId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as AccountNote;
      setNotes((prev) =>
        (prev ?? []).map((n) => (n.id === noteId ? { ...n, text: updated.text } : n)),
      );
      cancelEdit();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] edit failed', err);
      toast.error('Could not save edit');
    } finally {
      setEditSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    // Outer wrapper is a transparent click-target only — no background dim
    // and no backdrop blur, so the rest of the page stays fully visible
    // and usable while the drawer is open (matches the page-content-first
    // feel the user wants for the notes log).
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[420px] max-w-[calc(100vw-1.5rem)] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <ChatBubbleOvalLeftIcon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Notes — {accountLabel}</span>
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Account-level chat log. Visible to anyone with pacer access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex-shrink-0"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar px-4 py-3">
          {error ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Could not load notes: {error}
            </div>
          ) : notes == null ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Loading…
            </div>
          ) : notes.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">
              No notes yet. Add the first one below.
            </div>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0">
              {notes.map((note) => {
                const isMine =
                  !!currentUserId && note.authorUserId === currentUserId;
                const isEditing = editingId === note.id;
                const author = note.authorUserId
                  ? userMap.get(note.authorUserId)
                  : null;
                const stamp = new Date(note.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                return (
                  <li
                    key={note.id}
                    className={`rounded-lg border px-3 py-2 ${
                      isMine
                        ? 'border-[var(--primary)]/40 bg-[var(--primary)]/12'
                        : 'border-[var(--border)] bg-[var(--card)]'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1.5 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {author && (
                          <UserAvatar
                            name={author.name}
                            email={author.email}
                            avatarUrl={author.avatarUrl}
                            size={28}
                            className={`w-7 h-7 rounded-full object-cover flex-shrink-0 border ${
                              isMine
                                ? 'border-[var(--primary)]/60'
                                : 'border-[var(--border)]'
                            }`}
                          />
                        )}
                        <div className="flex flex-col min-w-0 leading-tight">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isMine ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                            }`}
                          >
                            {author?.name ?? 'Unknown'}
                          </span>
                          <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                            {stamp}
                          </span>
                        </div>
                      </div>
                      {!isEditing && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isMine && (
                            <button
                              type="button"
                              onClick={() => startEdit(note.id, note.text)}
                              className="text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                              aria-label="Edit note"
                              title="Edit"
                            >
                              <PencilSquareIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(note.id)}
                            className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                            aria-label="Delete note"
                            title="Delete"
                          >
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              saveEdit(note.id);
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                          className={`${inputClass} resize-none leading-relaxed`}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={editSaving}
                            className="px-2 py-1 text-[10px] font-medium rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(note.id)}
                            disabled={editSaving || !editText.trim()}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <CheckIcon className="w-3 h-3" />
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="m-0 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
                        {note.text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3 flex-shrink-0">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handlePost();
              }
            }}
            placeholder="Add a note… (⌘/Ctrl+Enter to post)"
            rows={3}
            className={`${inputClass} w-full resize-none text-xs`}
          />
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {text.trim().length > 0 ? `${text.trim().length} characters` : ''}
            </span>
            <button
              type="button"
              onClick={handlePost}
              disabled={!text.trim() || posting}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Budget Log ───────────────────────────────────────────────────────────
// Point-in-time snapshots of the per-ad pacer numbers (mirrors the
// Summary tab columns). Reps log entries while reviewing the monthly
// pacer to track when budgets were checked or adjusted.

interface AdSnapshot {
  adId: string;
  adName: string;
  budgetType: 'Daily' | 'Lifetime';
  budgetSource: 'base' | 'added' | 'split';
  budget: number;
  projected: number;
  actual: number | null;
  target: number | null;
  recDaily: number | null;
}

interface BudgetLogEntry {
  id: string;
  period: string;
  adsSnapshot: string; // JSON-encoded AdSnapshot[]
  note: string | null;
  authorUserId: string | null;
  createdAt: string;
}

function parseAdsSnapshot(raw: string): AdSnapshot[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AdSnapshot[]) : [];
  } catch {
    return [];
  }
}

// Mini snapshot table reused for both the live "current snapshot"
// preview and each entry in the history list. Mirrors the Summary tab
// columns at compact density.
function BudgetLogMiniTable({ rows }: { rows: AdSnapshot[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-3 text-center">
        No ads to snapshot.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {['Ad', 'Type', 'Budget', 'Projected', 'Actual', 'Target', 'Remaining'].map((h) => (
              <th
                key={h}
                className="px-1.5 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isLifetime = r.budgetType === 'Lifetime';
            return (
              <tr key={r.adId} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-1.5 py-1.5 text-[var(--foreground)] max-w-[140px] truncate">
                  {r.adName}
                </td>
                <td className="px-1.5 py-1.5">
                  <span
                    className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{
                      background: isLifetime
                        ? 'rgba(167,139,250,0.18)'
                        : 'rgba(56,189,248,0.18)',
                      color: isLifetime ? COLORS.lifetime : COLORS.daily,
                    }}
                  >
                    {r.budgetType}
                  </span>
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums whitespace-nowrap"
                  style={{ color: isLifetime ? COLORS.lifetime : COLORS.daily }}
                >
                  {fmt(r.budget)}
                  <span className="ml-0.5 text-[8px] text-[var(--muted-foreground)]">
                    {isLifetime ? 'total' : '/day'}
                  </span>
                </td>
                <td className="px-1.5 py-1.5 tabular-nums text-[var(--foreground)]">
                  {fmt(r.projected)}
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums"
                  style={{
                    color: r.actual != null ? COLORS.lifetime : 'var(--muted-foreground)',
                    opacity: r.actual != null ? 1 : 0.6,
                  }}
                >
                  {r.actual != null ? fmt(r.actual) : '—'}
                </td>
                <td
                  className="px-1.5 py-1.5 tabular-nums"
                  style={{
                    color: r.target != null ? 'var(--foreground)' : 'var(--muted-foreground)',
                    opacity: r.target != null ? 1 : 0.6,
                  }}
                >
                  {r.target != null ? fmt(r.target) : '—'}
                </td>
                {(() => {
                  // Remaining spend = target − actual. Positive = still to
                  // spend; negative (over target) shows red.
                  const remaining =
                    r.target != null ? r.target - (r.actual ?? 0) : null;
                  return (
                    <td
                      className="px-1.5 py-1.5 tabular-nums"
                      style={{
                        color:
                          remaining == null
                            ? 'var(--muted-foreground)'
                            : remaining < 0
                              ? COLORS.error
                              : COLORS.success,
                        opacity: remaining == null ? 0.6 : 1,
                      }}
                    >
                      {remaining != null ? fmt(remaining) : '—'}
                    </td>
                  );
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BudgetLogDrawer({
  accountKey,
  accountLabel,
  period,
  adsSnapshot,
  users,
  currentUserId,
  onClose,
}: {
  accountKey: string;
  accountLabel: string;
  period: string;
  // Live per-ad snapshot computed by the parent at render time. The
  // drawer captures this exact array when the user clicks Log.
  adsSnapshot: AdSnapshot[];
  users: DirectoryUser[];
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<BudgetLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  // Per-entry expand state — history is collapsed by default so the
  // drawer reads as a tidy list; click any entry to expand its full
  // per-ad snapshot.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const userMap = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/budget-log?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ entries: BudgetLogEntry[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLog = async () => {
    if (posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/budget-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          adsSnapshot,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      }
      const created = (await res.json()) as BudgetLogEntry;
      setEntries((prev) => [created, ...(prev ?? [])]);
      setNote('');
      toast.success('Budget logged');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer budget-log] post failed', err);
      toast.error('Could not log budget');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (logId: string) => {
    const prev = entries ?? [];
    setEntries(prev.filter((e) => e.id !== logId));
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/budget-log/${logId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer budget-log] delete failed', err);
      toast.error('Could not delete entry');
      setEntries(prev);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[640px] max-w-[calc(100vw-1.5rem)] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <ClipboardDocumentListIcon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Budget Log — {accountLabel}</span>
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Snapshots for {fmtPeriodLong(period)}. Captures per-ad budget, projected, actual, target, and rec. daily at the moment you log.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex-shrink-0"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Log-current panel — shows the live per-ad snapshot we'd
            capture if the user clicks Log right now, plus an optional
            note. */}
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--primary)]/5 flex-shrink-0 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
            Log current snapshot ({adsSnapshot.length} ad{adsSnapshot.length === 1 ? '' : 's'})
          </div>
          <BudgetLogMiniTable rows={adsSnapshot} />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleLog();
              }
            }}
            placeholder="Optional note (e.g. rebalanced after client call)…"
            rows={2}
            className={`${inputClass} w-full resize-none text-xs`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleLog}
              disabled={posting || adsSnapshot.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
            >
              <CheckIcon className="w-3.5 h-3.5" />
              {posting ? 'Logging…' : 'Log this budget'}
            </button>
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2">
            History
          </div>
          {error ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Could not load entries: {error}
            </div>
          ) : entries == null ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">
              No entries yet for this month. Log the first one above.
            </div>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0">
              {entries.map((entry) => {
                const isMine =
                  !!currentUserId && entry.authorUserId === currentUserId;
                const author = entry.authorUserId
                  ? userMap.get(entry.authorUserId)
                  : null;
                const stamp = new Date(entry.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                const rows = parseAdsSnapshot(entry.adsSnapshot);
                const expanded = expandedIds.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className={`rounded-lg border overflow-hidden ${
                      isMine
                        ? 'border-[var(--primary)]/40 bg-[var(--primary)]/12'
                        : 'border-[var(--border)] bg-[var(--card)]'
                    }`}
                  >
                    {/* Header row — toggle button on the left, delete on
                        the right (separate <button>s so nothing is nested). */}
                    <div className="flex justify-between items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(entry.id)}
                        aria-expanded={expanded}
                        aria-controls={`budget-log-body-${entry.id}`}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left rounded hover:bg-[var(--muted)]/30 transition-colors -mx-1 px-1 py-1"
                      >
                        {expanded ? (
                          <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
                        ) : (
                          <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
                        )}
                        {author && (
                          <UserAvatar
                            name={author.name}
                            email={author.email}
                            avatarUrl={author.avatarUrl}
                            size={28}
                            className={`w-7 h-7 rounded-full object-cover flex-shrink-0 border ${
                              isMine
                                ? 'border-[var(--primary)]/60'
                                : 'border-[var(--border)]'
                            }`}
                          />
                        )}
                        <div className="flex flex-col min-w-0 leading-tight">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isMine ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                            }`}
                          >
                            {author?.name ?? 'Unknown'}
                          </span>
                          <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                            {stamp} · {rows.length} ad{rows.length === 1 ? '' : 's'}
                            {entry.note && ' · has note'}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors flex-shrink-0 p-1 rounded"
                        aria-label="Delete entry"
                        title="Delete"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Body — collapsed by default */}
                    {expanded && (
                      <div id={`budget-log-body-${entry.id}`} className="px-3 pb-3 border-t border-[var(--border)] pt-2">
                        <BudgetLogMiniTable rows={rows} />
                        {entry.note && (
                          <p className="m-0 mt-2 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
                            {entry.note}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Change log drawer (automatic audit history, Change 10) ────────────────
interface AuditEntryView {
  id: string;
  adId: string | null;
  adName: string | null;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  summary: string;
  groupId: string | null;
  authorName: string;
  createdAt: string;
}

const AUDIT_ACTION_COLORS: Record<string, string> = {
  edit: 'var(--muted-foreground)',
  created: COLORS.success,
  deleted: COLORS.error,
  carryover: COLORS.lifetime,
  freeze: COLORS.warn,
  reopen: COLORS.warn,
  sync: COLORS.daily,
};

function ChangeLogDrawer({
  accountKey,
  accountLabel,
  period,
  onClose,
}: {
  accountKey: string;
  accountLabel: string;
  period: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/audit?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ entries: AuditEntryView[] }>;
      })
      .then((data) => {
        if (!cancelled) setEntries(Array.isArray(data?.entries) ? data.entries : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-modal relative h-full w-full max-w-md flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
              <ClockIcon className="w-4 h-4" />
              Change log
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)] truncate">
              {accountLabel} · {fmtPeriodLong(period)} · automatic history
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar p-4">
          {error ? (
            <div className="text-xs text-[#ef4444] text-center py-8">{error}</div>
          ) : entries == null ? (
            <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
              No changes recorded yet this month.
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span
                      className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        background: `${AUDIT_ACTION_COLORS[e.action] ?? 'var(--muted-foreground)'}22`,
                        color: AUDIT_ACTION_COLORS[e.action] ?? 'var(--muted-foreground)',
                      }}
                    >
                      {e.action}
                    </span>
                    <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap">
                      {fmtSyncedAgo(e.createdAt)}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--foreground)] leading-snug">
                    {e.summary}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                    {e.authorName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Small chat-bubble button that opens the account-level notes modal.
// The count badge surfaces when there's at least one note so reps can
// see at a glance which accounts have unread context.
function AccountNotesButton({
  count,
  onClick,
  ariaLabel,
}: {
  count: number | null;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="relative inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
    >
      <ChatBubbleOvalLeftIcon className="w-6 h-6" />
      {count != null && count > 0 && (
        <span
          className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
          style={{ background: COLORS.daily, color: '#0a0a0a' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

function BulkEditModal({
  field,
  count,
  users,
  onClose,
  onApply,
}: {
  field: BulkField;
  count: number;
  users: DirectoryUser[];
  onClose: () => void;
  onApply: (patch: Partial<PacerAd>) => void;
}) {
  const [flightStart, setFlightStart] = useState<string | null>(null);
  const [flightEnd, setFlightEnd] = useState<string | null>(null);
  const [budgetType, setBudgetType] = useState<'Daily' | 'Lifetime'>('Daily');
  const [budgetSource, setBudgetSource] = useState<'base' | 'added'>('base');
  const [ownerId, setOwnerId] = useState<string>('');
  const [adStatus, setAdStatus] = useState<string>(AD_STATUSES[0]);
  const [designStatus, setDesignStatus] = useState<string>(DESIGN_STATUSES[0]);
  const [internalApproval, setInternalApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );
  const [clientApproval, setClientApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );

  const noun = `${count} ad${count !== 1 ? 's' : ''}`;

  const handleSubmit = () => {
    switch (field) {
      case 'flight':
        if (!flightStart || !flightEnd) return;
        onApply({ flightStart, flightEnd });
        return;
      case 'budgetType':
        onApply({ budgetType });
        return;
      case 'budgetSource':
        onApply({ budgetSource });
        return;
      case 'owner':
        // Empty string clears the owner — treat that as a valid choice.
        onApply({ ownerUserId: ownerId === '' ? null : ownerId });
        return;
      case 'adStatus':
        onApply({ adStatus });
        return;
      case 'designStatus':
        onApply({ designStatus });
        return;
      case 'internalApproval':
        onApply({ internalApproval });
        return;
      case 'clientApproval':
        onApply({ clientApproval });
        return;
    }
  };

  const submitDisabled = field === 'flight' && (!flightStart || !flightEnd);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:pt-24 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-md rounded-xl p-5"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Set {BULK_FIELD_LABELS[field]}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Applies to {noun}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          {field === 'flight' && (
            <>
              <label className={labelClass}>Flight Range (Start – End)</label>
              <DatePicker
                mode="range"
                value={{ start: flightStart, end: flightEnd }}
                onChange={(r) => {
                  setFlightStart(r.start);
                  setFlightEnd(r.end);
                }}
                placeholder="Click & drag to select flight window"
              />
            </>
          )}
          {field === 'budgetType' && (
            <>
              <label className={labelClass}>Budget Type</label>
              <select
                value={budgetType}
                onChange={(e) => setBudgetType(e.target.value as 'Daily' | 'Lifetime')}
                className={inputClass}
              >
                <option value="Daily">Daily</option>
                <option value="Lifetime">Lifetime</option>
              </select>
            </>
          )}
          {field === 'budgetSource' && (
            <>
              <label className={labelClass}>Budget Source</label>
              <select
                value={budgetSource}
                onChange={(e) => setBudgetSource(e.target.value as 'base' | 'added')}
                className={inputClass}
              >
                <option value="base">Base</option>
                <option value="added">Added</option>
              </select>
            </>
          )}
          {field === 'owner' && (
            <>
              <label className={labelClass}>Owner</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'adStatus' && (
            <>
              <label className={labelClass}>Ad Status</label>
              <select
                value={adStatus}
                onChange={(e) => setAdStatus(e.target.value)}
                className={inputClass}
              >
                {AD_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'designStatus' && (
            <>
              <label className={labelClass}>Design Status</label>
              <select
                value={designStatus}
                onChange={(e) => setDesignStatus(e.target.value)}
                className={inputClass}
              >
                {DESIGN_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'internalApproval' && (
            <>
              <label className={labelClass}>Internal Status</label>
              <select
                value={internalApproval}
                onChange={(e) => setInternalApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'clientApproval' && (
            <>
              <label className={labelClass}>Client Status</label>
              <select
                value={clientApproval}
                onChange={(e) => setClientApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply to {noun}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Pacer row ─────────────────────────────────────────────────────────────

interface MetaAdSetOption {
  id: string;
  name: string;
  effectiveStatus: string | null;
  /** Parent campaign, shown as context so similar ad-set names are distinct. */
  campaignName: string | null;
}

/**
 * Searchable ad-set link picker — a custom combobox replacing the native
 * <select>. Accounts can have dozens of ad sets with long, similar names, so a
 * type-to-filter box (matching campaign + ad set + status) is far faster than
 * scrolling a plain dropdown. Lazy-loads the list on first open, closes on
 * outside-click / Escape.
 */
function AdSetLinkPicker({
  value,
  options,
  loading,
  error,
  onOpen,
  onChange,
  disabled,
}: {
  value: string | null;
  options: MetaAdSetOption[] | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);

  // Portal the panel to <body> with fixed coords so it escapes the card's
  // overflow-hidden + backdrop-filter and any scroll container that would
  // otherwise clip an absolutely-positioned dropdown. Flips above the trigger
  // when there isn't room below.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above only when there isn't room below AND there's more room above.
    // When flipping, anchor by the panel's *bottom* edge to the trigger's top
    // rather than computing a top from a height estimate — a short list (a few
    // ad sets) is far shorter than `estHeight`, so a top-anchored flip would
    // leave it floating hundreds of px above the trigger. Bottom-anchoring
    // keeps it glued to the trigger no matter how tall the list actually is.
    if (spaceBelow < estHeight && rect.top > spaceBelow) {
      setPos({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = (o: MetaAdSetOption) =>
    `${o.campaignName ? `${o.campaignName} › ` : ''}${o.name}`;
  const selected = (options ?? []).find((o) => o.id === value) ?? null;
  const buttonLabel = selected
    ? label(selected)
    : value
      ? `Linked ad set (${value})`
      : 'Not linked — match by name';

  const q = query.trim().toLowerCase();
  const filtered = (options ?? []).filter((o) =>
    `${o.campaignName ?? ''} ${o.name} ${o.effectiveStatus ?? ''}`
      .toLowerCase()
      .includes(q),
  );

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (!open) {
            onOpen();
            setQuery('');
          }
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-left text-[11px] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span
          className={`truncate ${selected || value ? '' : 'text-[var(--muted-foreground)]'}`}
        >
          {loading && !options ? 'Loading ad sets…' : buttonLabel}
        </span>
        <ChevronDownIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="glass-dropdown fixed z-[200]"
              style={{
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: Math.max(pos.width, 260),
              }}
            >
              <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5">
                <MagnifyingGlassIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ad sets…"
                  className="w-full bg-transparent text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
                />
              </div>
              <div className="max-h-64 overflow-y-auto themed-scrollbar py-1">
                {loading ? (
                  <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                    Loading ad sets…
                  </div>
                ) : error ? (
                  <div className="px-2.5 py-2 text-[11px] text-[#ef4444]">
                    {error}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => pick(null)}
                      className={`flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                        value
                          ? 'text-[var(--muted-foreground)]'
                          : 'font-medium text-[var(--foreground)]'
                      }`}
                    >
                      Not linked — match by name
                    </button>
                    {filtered.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pick(o.id)}
                        className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                          o.id === value ? 'bg-[var(--muted)]/60 font-medium' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 text-[var(--foreground)]">
                          {o.campaignName && (
                            <span className="text-[var(--muted-foreground)]">
                              {o.campaignName} ›{' '}
                            </span>
                          )}
                          {o.name}
                        </span>
                        {o.effectiveStatus && (
                          <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)] mt-0.5">
                            {o.effectiveStatus}
                          </span>
                        )}
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                        No ad sets match “{query}”.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PacerRow({
  ad,
  index,
  timeZone,
  onActualChange,
  onDailyBudgetChange,
  expanded,
  onToggleExpanded,
  adSets,
  adSetsLoading,
  adSetsError,
  onLoadAdSets,
  onLinkChange,
  onMuteToggle,
  onMarkOff,
  onPushDailyBudget,
  onResolveCrossMonth,
}: {
  ad: PacerAd;
  index: number;
  timeZone: string;
  onActualChange: (v: string | null) => void;
  onDailyBudgetChange: (v: string | null) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  adSets: MetaAdSetOption[] | null;
  adSetsLoading: boolean;
  adSetsError: string | null;
  onLoadAdSets: () => void;
  onLinkChange: (adSetId: string | null) => void;
  onMuteToggle: () => void;
  onMarkOff: () => void;
  /** Push the row's current daily budget to its linked Meta ad set. */
  onPushDailyBudget: (value: string) => Promise<{ ok: boolean; text: string }>;
  /** §2: resolve a cross-month straddler — count its full run in its own month
   *  (apply_full_run), set a lifetime planned split, or clear. Persists server-side. */
  onResolveCrossMonth: (
    action: 'apply_full_run' | 'split' | 'clear',
    splitMap?: Record<string, number>,
  ) => void;
}) {
  const isLifetime = ad.budgetType === 'Lifetime';
  const typeColor = isLifetime ? COLORS.lifetime : COLORS.daily;
  // Once a row is linked to Meta and has synced, Meta owns its actual spend
  // (read-only here) and its daily budget is edited-then-pushed, not free-typed.
  const syncedFromMeta = !!ad.metaObjectId && !!ad.pacerSyncedAt;
  // Daily-budget editor state: collapsed (read-only + pencil) until the user
  // opts in; once they change the value a "Push to Meta" action appears.
  const [dailyEditing, setDailyEditing] = useState(false);
  const [dailyStart, setDailyStart] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  // Full-run spend is opt-in per ad: a multi-month lifetime ad often only
  // needs its current-month figure, so we hide the full run behind a toggle and
  // show it only when the user asks for that ad.
  const [showRunSpend, setShowRunSpend] = useState(false);
  const dailyChanged =
    dailyEditing && (ad.pacerDailyBudget ?? '') !== (dailyStart ?? '');
  const beginDailyEdit = () => {
    setDailyStart(ad.pacerDailyBudget ?? '');
    setPushMsg(null);
    setDailyEditing(true);
  };
  const pushDaily = async () => {
    setPushing(true);
    setPushMsg(null);
    const res = await onPushDailyBudget(ad.pacerDailyBudget ?? '');
    setPushMsg(res);
    setPushing(false);
    if (res.ok) setDailyStart(ad.pacerDailyBudget ?? '');
  };
  // Discard edits — restore the value captured when editing began so a changed
  // mind (or an accidental clear) can't wipe the budget.
  const cancelDailyEdit = () => {
    onDailyBudgetChange(dailyStart);
    setPushMsg(null);
    setDailyEditing(false);
  };

  // "Now" = the current instant; the day boundary that bounds the recommended
  // daily is resolved in the account's timezone inside buildPacerCalc. Captured
  // per ad/timezone change so the row's numbers stay stable between renders.
  const calc = useMemo(
    () => buildPacerCalc(ad, Date.now(), timeZone),
    [ad, timeZone],
  );
  // The date being paced TO — the Meta/planned end clamped to the pacing
  // month (Change 4). Drives the "until …" labels and the completed banner.
  const effectiveEnd = calc.effectiveEnd;
  const readOnly = usePacerReadOnly();

  const isPastRun = calc.endsBeforeToday;
  const isMarkedCompleted = ad.adStatus === 'Completed Run';
  const isMarkedOff = ad.adStatus === 'Off';
  // Off / Completed Run freeze pacing math: spend is final, no further
  // projection or daily-adjustment makes sense. Past-flight ads without an
  // explicit status fall through to the "Mark as completed" prompt.
  const showCompletedSummary = isMarkedCompleted || isMarkedOff;

  // Color the recommended-vs-current daily comparison
  const dailyDelta = calc.recDaily - calc.dailyBudget;
  const isOnTrack = calc.budget > 0 && Math.abs(dailyDelta) < 0.5;
  const recColor = isOnTrack
    ? COLORS.success
    : calc.recDaily > calc.dailyBudget
      ? COLORS.warn
      : COLORS.lifetime;

  // Health-based accent colors the left stripe AND the compact pacing
  // badge in the summary row, so both UI elements agree on the bucket.
  const health = useMemo(() => classifyPacerHealth(ad, calc), [ad, calc]);

  // Resolved = the user billed the ad's full run in its own month
  // (fullRunAppliedToMonth). Cross-month accounting is a MANUAL choice via the
  // dropdown below — nothing is auto-detected.
  const resolvedFullRun = ad.fullRunAppliedToMonth != null;

  // Status indicator color — pulled from the same map AdStatusPill uses
  // so the dot matches the status the user sees on the planner page.
  const statusColor = AD_STATUS_COLORS[ad.adStatus]?.[0] ?? 'var(--muted-foreground)';
  // Health icon picks the right semantic affordance per bucket — keeps
  // the loudest verdict (health pill) visually distinct from the
  // quieter status dot + budget-type suffix.
  const HealthIcon =
    health.state === 'on-track'
      ? CheckCircleIcon
      : health.state === 'stopped' || health.state === 'no-data'
        ? MinusCircleIcon
        : ExclamationTriangleIcon;
  const healthMuted = health.state === 'stopped' || health.state === 'no-data';

  // Compact one-line summary row. Four visual languages, one per signal:
  //   - identity:   colored ad-dot + name
  //   - status:     colored dot + plain text (workflow lifecycle)
  //   - values:     budget number + /day or total suffix (carries type)
  //   - verdict:    loud health pill with leading icon (the answer)
  const summaryRow = (
    // A div (not a button) so the inline Mute toggle can be a real nested
    // button. Row still expands on click / Enter / Space.
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleExpanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpanded();
        }
      }}
      aria-expanded={expanded}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--muted)]/30 transition-colors cursor-pointer"
    >
      {expanded ? (
        <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
      ) : (
        <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
      )}
      {/* Identity zone — ad-dot + name + status all grouped on the left
          so the status reads as adjacent context to the ad, not as a
          separate column out near the metrics. */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="w-2 h-2 rounded-sm flex-shrink-0"
          style={{ background: AD_COLORS[index % AD_COLORS.length] }}
        />
        <span className="text-sm font-semibold text-[var(--foreground)] truncate min-w-0">
          {ad.name || 'Untitled Ad'}
        </span>
        {/* Status: dot + plain text, no pill chrome (workflow state, not
            a verdict — quieter than the health pill on the right). */}
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: statusColor }}
          />
          {ad.adStatus || 'No status'}
        </span>
        {/* Cross-month / resolution chips live HERE (next to the name) rather
            than out by the metrics, so the Actual / Budget / verdict columns
            stay aligned down the list whether or not a chip is present. */}
        {resolvedFullRun && (
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
            style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }}
            title="Full run counted in this ad's own month — the over/under compares the full run to the full target."
          >
            Full run ✓
          </span>
        )}
        {ad.lifetimeMonthSplit && (
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
            style={{ background: 'rgba(167,139,250,0.12)', color: COLORS.lifetime }}
            title="Lifetime ad with a planned per-month split (reference only — the variance books once on completion)."
          >
            Split
          </span>
        )}
      </div>
      {/* Actual spend — labelled so the bare number isn't ambiguous. Fixed
          width + right-aligned so it forms a consistent column down the list. */}
      <span className="hidden sm:inline-flex items-baseline justify-end gap-1 text-[11px] tabular-nums whitespace-nowrap flex-shrink-0 w-[132px]">
        <span className="text-[var(--muted-foreground)]">Actual</span>
        <span className="text-[var(--foreground)] font-semibold">
          {calc.spent > 0 ? fmt(calc.spent) : '—'}
        </span>
      </span>
      {/* Budget — suffix `/day` or ` total` carries the lifetime/daily
          mode so the LIFETIME / DAILY pill is no longer needed. Fixed width +
          right-aligned to line up with the column above. */}
      <span
        className="hidden md:inline-flex items-baseline justify-end gap-1 text-[11px] tabular-nums whitespace-nowrap flex-shrink-0 font-semibold w-[108px]"
        style={{ color: typeColor }}
      >
        {isLifetime ? (
          calc.budget > 0 ? (
            <>
              {fmt(calc.budget)}
              <span className="text-[10px] font-normal text-[var(--muted-foreground)]">
                total
              </span>
            </>
          ) : (
            '—'
          )
        ) : calc.dailyBudget > 0 ? (
          <>
            {fmt(calc.dailyBudget)}
            <span className="text-[10px] font-normal text-[var(--muted-foreground)]">
              /day
            </span>
          </>
        ) : (
          '—'
        )}
      </span>
      {/* Verdict pill — the loudest signal in the row. Solid colored
          background + leading icon so the eye lands here first. */}
      <span
        className="inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md flex-shrink-0 min-w-[92px]"
        style={{
          background: healthMuted ? 'rgba(255,255,255,0.06)' : `${health.color}26`,
          color: healthMuted ? 'var(--muted-foreground)' : health.color,
          border: `1px solid ${healthMuted ? 'transparent' : `${health.color}55`}`,
        }}
      >
        <HealthIcon className="w-3 h-3 flex-shrink-0" />
        {health.short}
      </span>
    </div>
  );

  return (
    <div className="glass-section-card pacer-ad-card relative rounded-xl mb-2.5 overflow-hidden">
      {/* Left-edge accent stripe colored by pacing health — visible on
          both summary and expanded states. */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1"
        style={{ background: health.color }}
      />
      {summaryRow}
      {!expanded ? null : (
        <div className="border-t border-[var(--border)] px-5 py-4 pl-6">

      {/* Header row inside the expanded view — Target Spend (value +
          type + source/split breakdown) on the left, Flight window on
          the right. Replaces the old 5-column inputs grid Target Spend
          field so all of the read-only context lives together up top,
          and the inputs row below can focus on the two values reps
          actually edit. */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex-shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Target Spend
          </div>
          {/* Value + source tag on one line — the source sits to the RIGHT of
              the target spend. Split ads also surface the Base / Added
              breakdown so the bucket allocation is visible right where the
              budget lives. */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-base font-bold tabular-nums"
                style={{ color: typeColor }}
              >
                {calc.budget > 0 ? fmt(calc.budget) : '—'}
              </span>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {isLifetime ? 'total' : '/day target'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {/* Budget type — Daily (blue) vs Lifetime (purple), matching the
                  table-view tag — so the daily-rate vs fixed-total distinction
                  is explicit, not just implied by the "/day" vs "total" suffix. */}
              <span
                className="font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{
                  background: isLifetime
                    ? 'rgba(167,139,250,0.18)'
                    : 'rgba(56,189,248,0.18)',
                  color: typeColor,
                }}
              >
                {ad.budgetType}
              </span>
              <span
                className="font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{
                  background: sourceTint(ad.budgetSource),
                  color: sourceColor(ad.budgetSource),
                }}
              >
                {sourceLabel(ad.budgetSource)}
              </span>
              {ad.budgetSource === 'split' && (() => {
                const baseAmt = num(ad.splitBaseAmount) ?? 0;
                const addedAmt = Math.max(0, calc.budget - baseAmt);
                return (
                  <span className="text-[var(--muted-foreground)]">
                    Base {fmt(baseAmt)} / Added {fmt(addedAmt)}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        {/* Mute alerts lives in the expanded-card footer (bottom-right),
            so the header just carries the Flight window. */}
        {ad.flightStart && ad.flightEnd && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Flight
            </div>
            <div className="text-base font-bold text-[var(--foreground)] whitespace-nowrap">
              {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)]">
              {calcDays(ad.flightStart, ad.flightEnd)} days
            </div>
          </div>
        )}
      </div>

      {/* Editable inputs row — just the two values reps actually edit.
          Today's date always uses the current date and end date uses
          the immutable flight end, so neither needs an input. */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,300px)_minmax(0,160px)] gap-3 mb-3.5">
        <Field label="Actual Spend">
          {syncedFromMeta ? (
            // Meta owns the spend once synced — plain read-only value, not a
            // box that looks editable.
            <div
              className="flex items-center gap-2 py-2 cursor-default"
              title="Actual spend is pulled from Meta and isn't editable here. Re-run Sync from Meta to refresh."
            >
              <span className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {fmt(num(ad.pacerActual) ?? 0)}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                <MetaBrandIcon className="w-3 h-3" />
                from Meta
              </span>
            </div>
          ) : (
            <DollarInput
              value={ad.pacerActual}
              onChange={onActualChange}
              placeholder="0.00"
            />
          )}
          {/* Meta ad-set link. Picking an ad set overrides the name-match;
              spend (and ABO budget) then come from "Sync from Meta". */}
          <div className="mt-1.5">
            <AdSetLinkPicker
              value={ad.metaObjectId}
              options={adSets}
              loading={adSetsLoading}
              error={adSetsError}
              onOpen={onLoadAdSets}
              onChange={onLinkChange}
              disabled={readOnly}
            />
            {adSetsError && (
              <div className="mt-1 text-[10px] text-[#ef4444]">
                {adSetsError}
              </div>
            )}
            {ad.metaObjectId && ad.pacerSyncedAt ? (
              <div
                className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]"
                title="Spend pulled from the linked Meta ad set. Re-run Sync from Meta to refresh."
              >
                <MetaBrandIcon className="w-3 h-3 flex-shrink-0" />
                <span>Synced from Meta · {fmtSyncedAgo(ad.pacerSyncedAt)}</span>
              </div>
            ) : ad.metaObjectId ? (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                <MetaBrandIcon className="w-3 h-3 flex-shrink-0" />
                <span>Linked — click &ldquo;Sync from Meta&rdquo; to pull spend</span>
              </div>
            ) : null}
            {/* Meta's actual run schedule (from the sync), shown alongside the
                planner's flight dates. When the run extends past the pacing
                month, surface that the pacer is scoped to month-end so the
                shorter "Days Remaining" reads as intended, not as a bug. */}
            {(ad.metaStartDate || ad.metaEndDate) && (
              <div className="mt-1 flex items-start gap-1 text-[10px] text-[var(--muted-foreground)]">
                <CalendarIcon className="w-3 h-3 flex-shrink-0 mt-px" />
                <span>
                  Meta run: {ad.metaStartDate ? fmtDate(ad.metaStartDate) : '—'}{' '}
                  → {ad.metaEndDate ? fmtDate(ad.metaEndDate) : 'ongoing'}
                  {effectiveEnd &&
                    (!ad.metaEndDate || ad.metaEndDate > effectiveEnd) && (
                      <span className="text-[var(--foreground)]/70">
                        {' '}· paced to {fmtDate(effectiveEnd)} (month end)
                      </span>
                    )}
                </span>
              </div>
            )}
            {/* Full-run (all-month) spend — opt-in per ad. Only offered when the
                ad's total run exceeds this month's spend (a genuine multi-month
                ad). Hidden behind a toggle so a lifetime ad you only care about
                this month for stays uncluttered; click to see the full date
                range. The monthly Actual above always drives this month's pacing. */}
            {(() => {
              const run = num(ad.pacerRunSpend);
              const month = num(ad.pacerActual) ?? 0;
              if (run == null || run <= month + 0.005) return null;
              return (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowRunSpend((v) => !v)}
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    <MetaBrandIcon className="w-3 h-3 flex-shrink-0" />
                    {showRunSpend ? 'Hide full-run spend' : 'View full-run spend'}
                  </button>
                  {showRunSpend && (
                    <div
                      className="mt-1 flex items-start gap-1 text-[10px] text-[var(--muted-foreground)]"
                      title="Total spend across the ad's entire flight (all months), pulled from Meta. The monthly Actual above is what drives this month's pacing."
                    >
                      <span>
                        Full run:{' '}
                        <span className="font-semibold tabular-nums text-[var(--foreground)]">
                          {fmt(run)}
                        </span>
                        {(ad.metaStartDate || ad.metaEndDate) && (
                          <>
                            {' '}·{' '}
                            {ad.metaStartDate ? fmtDate(ad.metaStartDate) : '—'} →{' '}
                            {ad.metaEndDate ? fmtDate(ad.metaEndDate) : 'ongoing'}
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Meta status mismatch (Change 11): Meta reports the ad not
                delivering while the planner still says Live and it's mid-flight.
                Don't auto-flip (Meta "paused" can be a daily cap / billing hold)
                — surface a one-click confirm. Past-end ads auto-complete server
                side, so they won't reach here. */}
            {(() => {
              const meta = ad.metaEffectiveStatus;
              const plannerLive =
                ad.adStatus === 'Live' || ad.adStatus === 'Live - Changes Required';
              if (!meta || !plannerLive || meta.toUpperCase() === 'ACTIVE') {
                return null;
              }
              const through = ad.metaEndDate ?? ad.flightEnd;
              return (
                <div
                  className="mt-1.5 rounded-md border px-2 py-1.5 text-[10px]"
                  style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.08)' }}
                >
                  <div className="text-[var(--foreground)] leading-snug">
                    Meta shows <span className="font-semibold">{meta}</span>
                    {through ? <> — but scheduled through {fmtDate(through)}</> : null}.
                  </div>
                  <button
                    type="button"
                    onClick={onMarkOff}
                    disabled={readOnly}
                    className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Mark Off in planner
                  </button>
                </div>
              );
            })()}
          </div>
        </Field>
        <Field label="Daily Budget">
          {isLifetime ? (
            <div
              className={`${readonlyClass} italic`}
              title="Lifetime ads use a fixed total budget, not a daily rate"
            >
              N/A — lifetime
            </div>
          ) : !syncedFromMeta ? (
            // Manual / unlinked — free-typed as before.
            <DollarInput
              value={ad.pacerDailyBudget}
              onChange={onDailyBudgetChange}
              placeholder="0.00"
            />
          ) : !dailyEditing ? (
            // Synced — plain read-only value with a pencil to reveal the input.
            // Not a box that looks editable until you click the pencil.
            <div className="flex items-center gap-2 py-2">
              <span className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {ad.pacerDailyBudget != null && ad.pacerDailyBudget !== ''
                  ? fmt(num(ad.pacerDailyBudget) ?? 0)
                  : '—'}
              </span>
              <button
                type="button"
                onClick={beginDailyEdit}
                disabled={readOnly}
                title="Edit daily budget"
                aria-label="Edit daily budget"
                className="inline-flex items-center justify-center rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            // Editing — the input, a full-width Push action shown only once the
            // value changes, and a tidy right-aligned Cancel / Done row.
            <div className="space-y-2">
              <DollarInput
                value={ad.pacerDailyBudget}
                onChange={onDailyBudgetChange}
                placeholder="0.00"
              />
              {dailyChanged && (
                <button
                  type="button"
                  onClick={pushDaily}
                  disabled={pushing || readOnly}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MetaBrandIcon className="w-3.5 h-3.5" />
                  {pushing ? 'Pushing…' : 'Push to Meta'}
                </button>
              )}
              <div className="flex items-center justify-end gap-4 text-[11px]">
                {/* Cancel restores the original value; Done keeps the edit. */}
                <button
                  type="button"
                  onClick={cancelDailyEdit}
                  disabled={pushing}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDailyEditing(false);
                    setPushMsg(null);
                  }}
                  disabled={pushing}
                  className="font-semibold text-[var(--primary)] hover:opacity-80 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
              {pushMsg && (
                <div
                  className={`text-[10px] ${pushMsg.ok ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}
                >
                  {pushMsg.text}
                </div>
              )}
            </div>
          )}
        </Field>
      </div>

      {/* Cross-month accounting — a manual dropdown on EVERY card. Nothing is
          auto-detected; you mark the ads (mostly lifetime) that need it.
          "Bill in one month" = the whole run + target counts in this month ($0
          elsewhere); "Split across months" = each month keeps its own spend (a
          lifetime ad settles when the run completes), with an optional planned
          per-month split for reference. */}
      {(() => {
        const rawStart = ad.flightStart ?? ad.metaStartDate ?? ad.liveDate;
        const rawEnd = ad.flightEnd ?? ad.metaEndDate;
        const months: string[] = [];
        if (rawStart && rawEnd) {
          let y = Number(rawStart.slice(0, 4));
          let mo = Number(rawStart.slice(5, 7));
          const ey = Number(rawEnd.slice(0, 4));
          const em = Number(rawEnd.slice(5, 7));
          while ((y < ey || (y === ey && mo <= em)) && months.length < 25) {
            months.push(`${y}-${String(mo).padStart(2, '0')}`);
            mo += 1;
            if (mo > 12) {
              mo = 1;
              y += 1;
            }
          }
        }
        let split: Record<string, number> | null = null;
        try {
          split = ad.lifetimeMonthSplit
            ? (JSON.parse(ad.lifetimeMonthSplit) as Record<string, number>)
            : null;
        } catch {
          split = null;
        }
        // Full run can't be below the in-month slice; fall back to the entered
        // actual when Meta run-spend isn't synced so the verdict isn't $0.
        const run = Math.max(num(ad.pacerRunSpend) ?? 0, num(ad.pacerActual) ?? 0);
        const target = num(ad.allocation) ?? 0;
        const billActive = resolvedFullRun;
        return (
          <div className="mt-3 mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label
                className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]"
                htmlFor={`cm-${ad.id}`}
              >
                Cross-month accounting
              </label>
              <select
                id={`cm-${ad.id}`}
                value={billActive ? 'bill' : 'split'}
                disabled={readOnly}
                onChange={(e) =>
                  onResolveCrossMonth(
                    e.target.value === 'bill' ? 'apply_full_run' : 'clear',
                  )
                }
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] font-medium text-[var(--foreground)] disabled:opacity-50"
              >
                <option value="split">Split across months</option>
                <option value="bill">Bill in one month</option>
              </select>
            </div>
            {billActive ? (
              <div className="text-[11px] text-[var(--foreground)] mt-1.5">
                Full run <span className="font-semibold">{fmt(run)}</span> vs target{' '}
                <span className="font-semibold">{fmt(target)}</span>
                {target > 0 &&
                  (() => {
                    // The full-run pacing verdict — so you can see the whole run
                    // paced correctly even though the month's actual is just the
                    // in-month slice. ±10% reads on track.
                    const d = run / target - 1;
                    const verdict =
                      Math.abs(d) <= 0.1
                        ? { t: '✓ on target', c: COLORS.success }
                        : d > 0
                          ? { t: `+${(d * 100).toFixed(0)}% over`, c: COLORS.error }
                          : { t: `${(d * 100).toFixed(0)}% under`, c: COLORS.warn };
                    return (
                      <>
                        {' — '}
                        <span className="font-semibold" style={{ color: verdict.c }}>
                          {verdict.t}
                        </span>
                      </>
                    );
                  })()}
                {' · counts in '}
                <span className="font-semibold" style={{ color: '#38bdf8' }}>
                  {fmtPeriodLong(ad.fullRunAppliedToMonth ?? ad.period)}
                </span>
                ; other months show $0.
              </div>
            ) : (
              <div className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
                {isLifetime
                  ? 'Each month keeps its own spend; the full variance settles when the run completes.'
                  : "Each month keeps its own spend (the over/under uses this month's slice)."}
                {isLifetime && months.length > 1 && split == null && (
                  <button
                    type="button"
                    onClick={() => {
                      const per = Math.round((target / months.length) * 100) / 100;
                      const map: Record<string, number> = {};
                      months.forEach((mm) => {
                        map[mm] = per;
                      });
                      onResolveCrossMonth('split', map);
                    }}
                    disabled={readOnly}
                    className="ml-1 text-[var(--primary)] hover:underline disabled:opacity-50"
                  >
                    Plan an even split (reference)
                  </button>
                )}
                {isLifetime && split != null && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold" style={{ color: COLORS.lifetime }}>
                        Planned split (reference only)
                      </span>
                      <button
                        type="button"
                        onClick={() => onResolveCrossMonth('clear')}
                        disabled={readOnly}
                        className="text-[10px] hover:underline disabled:opacity-50"
                      >
                        Clear split
                      </button>
                    </div>
                    {months.map((mm) => (
                      <div
                        key={mm}
                        className="flex justify-between gap-3 text-[var(--foreground)]"
                      >
                        <span>{fmtPeriodLong(mm)}</span>
                        <span className="text-[var(--muted-foreground)]">
                          {mm === ad.period
                            ? `actual ${fmt(num(ad.pacerActual) ?? 0)} · `
                            : ''}
                          planned {fmt(split?.[mm] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}


      {/* Stopped / past-due states replace the projection grid. Off or
          Completed Run freezes the math at the entered actuals; past-flight
          ads without an explicit status get a banner prompting the user to
          mark the status. */}
      {showCompletedSummary ? (
        <PacerCompletedSummary
          ad={ad}
          calc={calc}
          isLifetime={isLifetime}
          effectiveEnd={effectiveEnd}
          variant={isMarkedOff ? 'off' : 'completed'}
        />
      ) : isPastRun ? (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: COLORS.success }}
        >
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: COLORS.success }}
            >
              Completed run
            </div>
            <div className="text-base font-bold text-[var(--foreground)] mt-0.5">
              Spent {fmt(calc.spent)}
              {calc.budget > 0 && (
                <span className="text-xs text-[var(--muted-foreground)] font-normal ml-2">
                  of {fmt(calc.budget)} target
                </span>
              )}
            </div>
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] max-w-[260px] text-right">
            Mark this ad as <span className="font-semibold">Completed Run</span>{' '}
            in the planner to lock in a final summary.
          </div>
        </div>
      ) : (
        <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {isLifetime ? (
          (() => {
            const pct = calc.lifetimePacingPct;
            const onTrack = pct != null && pct >= 95 && pct <= 105;
            const overpacing = pct != null && pct > 105;
            const underpacing = pct != null && pct < 95;
            const color = onTrack
              ? COLORS.success
              : overpacing
                ? COLORS.warn
                : underpacing
                  ? COLORS.error
                  : undefined;
            return (
              <MetricBox
                label="Pacing"
                value={pct != null ? `${pct.toFixed(1)}%` : '—'}
                sub={
                  pct == null
                    ? 'set flight start, end, and target'
                    : onTrack
                      ? 'on track'
                      : overpacing
                        ? 'spending faster than scheduled'
                        : 'spending slower than scheduled'
                }
                color={color}
              />
            );
          })()
        ) : (
          <MetricBox
            label="Projected Spend"
            value={
              calc.hasDates && !calc.endsBeforeToday
                ? fmt(calc.projected)
                : '—'
            }
            sub={
              !calc.hasDates
                ? 'set today + end dates'
                : calc.endsBeforeToday
                  ? 'end is before today'
                  : `spend + ${fmt(calc.dailyBudget)}/d × ${fmtDaysNum(calc.daysLeft)}d`
            }
          />
        )}
        <MetricBox
          label="Days Remaining"
          value={
            calc.hasDates && !calc.endsBeforeToday
              ? fmtDaysLeft(calc.daysLeft)
              : '—'
          }
          sub={
            calc.endsBeforeToday
              ? 'window already closed'
              : calc.hasDates
                ? `until ${fmtDate(effectiveEnd)}`
                : 'set today + end dates'
          }
        />
        <MetricBox
          label="Remaining Budget"
          value={calc.budget > 0 ? fmt(calc.remaining) : '—'}
          sub={
            calc.budget > 0
              ? calc.spent > calc.budget
                ? `over by ${fmt(calc.spent - calc.budget)}`
                : `${fmt(calc.spent)} of ${fmt(calc.budget)} spent`
              : 'set Target Spend'
          }
          color={
            calc.budget > 0
              ? calc.spent > calc.budget
                ? COLORS.error
                : COLORS.success
              : undefined
          }
        />
        <MetricBox
          label="Rec. Daily Adjustment"
          value={
            calc.budget > 0 && calc.daysLeft > 0
              ? fmt(calc.recDaily)
              : '—'
          }
          // First line: the formula — remaining budget ÷ remaining days — since
          // that's exactly what the recommendation is (recDaily = remaining /
          // max(daysLeft, 1)). The divisor floors at 1 on the final day so the
          // tail can't blow up, labeled so the "1 day" is understood.
          sub={
            calc.budget <= 0
              ? 'set Target Spend'
              : calc.daysLeft <= 0
                ? 'no days remaining'
                : calc.daysLeft >= 1
                  ? `${fmt(calc.remaining)} remaining ÷ ${fmtDaysBasisPhrase(calc.daysLeft)} left`
                  : `${fmt(calc.remaining)} remaining ÷ 1 day (final day)`
          }
          // Second line (below the formula): the plain-language action — how
          // much to add to / cut from the current daily budget to hit the rec.
          detail={
            calc.budget > 0 && calc.daysLeft > 0
              ? isOnTrack
                ? 'On track — no change needed'
                : dailyDelta > 0
                  ? `Add ${fmt(Math.abs(dailyDelta))} to current Daily Budget`
                  : `Reduce current Daily Budget by ${fmt(Math.abs(dailyDelta))}`
              : undefined
          }
          color={recColor}
        />
      </div>

      {/* Footer — plain-English insight on the left, Mute alerts toggle on the
          right in its own area. */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          {(() => {
        if (calc.budget <= 0) return null;
        if (!calc.hasDates) return null;
        if (calc.spent >= calc.budget) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.error }}
            >
              Budget already fully spent
              {calc.spent > calc.budget
                ? ` (over by ${fmt(calc.spent - calc.budget)})`
                : ''}
              . Consider pausing the ad or increasing the target spend.
            </p>
          );
        }
        if (isLifetime) {
          return (
            <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {fmt(calc.remaining)} of the lifetime budget left across{' '}
              {fmtDaysLeft(calc.daysLeft)}. To finish on time, average ~
              {fmt(calc.recDaily)}/day.
            </p>
          );
        }
        const overspendThreshold = calc.budget * 1.05;
        const underspendThreshold = calc.budget * 0.95;
        if (calc.projected > overspendThreshold) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.warn }}
            >
              At your current rate of {fmt(calc.dailyBudget)}/day you&apos;re
              projected to overspend by{' '}
              {fmt(calc.projected - calc.budget)} by{' '}
              {fmtDate(effectiveEnd)}. Lower the daily budget to{' '}
              {fmt(calc.recDaily)} to stay on target.
            </p>
          );
        }
        if (calc.projected < underspendThreshold) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.lifetime }}
            >
              At your current rate you&apos;ll underspend by{' '}
              {fmt(calc.budget - calc.projected)} — bumping the daily budget
              to {fmt(calc.recDaily)} will use the full target by{' '}
              {fmtDate(effectiveEnd)}.
            </p>
          );
        }
        return (
          <p
            className="m-0 text-[11px] leading-relaxed"
            style={{ color: COLORS.success }}
          >
            Pacing well — a small adjustment keeps you on track for{' '}
            {fmtDate(effectiveEnd)}.
          </p>
        );
      })()}
        </div>
        {/* Mute alerts — text button in the card footer (bell = on,
            bell-with-slash + amber = muted). */}
        <button
          type="button"
          onClick={onMuteToggle}
          disabled={readOnly}
          title={
            ad.alertsMuted
              ? 'Alerts muted for this ad — click to unmute'
              : 'Mute pacing / dark / flight alerts for this ad'
          }
          className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            ad.alertsMuted
              ? 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.12)] text-[#f59e0b]'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          {ad.alertsMuted ? (
            <BellOffIcon className="w-3.5 h-3.5" />
          ) : (
            <BellIcon className="w-3.5 h-3.5" />
          )}
          {ad.alertsMuted ? 'Alerts muted' : 'Mute alerts'}
        </button>
      </div>
        </>
      )}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only completion summary for ads marked `Completed Run` whose end date
 * is behind the effective today cursor. Mirrors the live pacer metric grid
 * but locks the values to what was spent vs. what was targeted.
 */
function PacerCompletedSummary({
  ad,
  calc,
  isLifetime,
  effectiveEnd,
  variant = 'completed',
}: {
  ad: PacerAd;
  calc: ReturnType<typeof buildPacerCalc>;
  isLifetime: boolean;
  effectiveEnd: string | null;
  variant?: 'completed' | 'off';
}) {
  const variance = calc.budget > 0 ? calc.spent - calc.budget : null;
  const variancePct =
    calc.budget > 0 ? ((calc.spent - calc.budget) / calc.budget) * 100 : null;
  const start = ad.liveDate || ad.flightStart;
  const daysRun = start && effectiveEnd ? calcDays(start, effectiveEnd) : 0;
  const varianceColor =
    variance == null
      ? undefined
      : Math.abs(variance) < 0.005
        ? COLORS.success
        : variance > 0
          ? COLORS.error
          : COLORS.warn;
  const isOff = variant === 'off';
  const headerColor = isOff ? COLORS.warn : COLORS.success;
  const headerBg = isOff ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)';
  const headerLabel = isOff ? 'Ad turned off' : 'Run complete';
  const dateLabel = isOff
    ? effectiveEnd
      ? `Was scheduled through ${fmtDate(effectiveEnd)}`
      : null
    : effectiveEnd
      ? `Ran through ${fmtDate(effectiveEnd)}`
      : null;
  return (
    <div>
      <div
        className="rounded-lg border px-4 py-3 mb-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderColor: headerColor, background: headerBg }}
      >
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: headerColor }}
          >
            {headerLabel}
          </div>
          <div className="text-base font-bold text-[var(--foreground)] mt-0.5">
            Final spend {fmt(calc.spent)}
          </div>
        </div>
        {dateLabel && (
          <div className="text-[10px] text-[var(--muted-foreground)] text-right">
            {dateLabel}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricBox
          label="Actual Spend"
          value={fmt(calc.spent)}
          sub="entered in pacer"
        />
        <MetricBox
          label="Target Spend"
          value={calc.budget > 0 ? fmt(calc.budget) : '—'}
          sub={calc.budget > 0 ? 'allocation' : 'no allocation set'}
        />
        <MetricBox
          label={isLifetime ? 'Implied Daily' : 'Daily Budget'}
          value={
            isLifetime
              ? daysRun > 0
                ? fmt(calc.spent / daysRun)
                : '—'
              : calc.dailyBudget > 0
                ? fmt(calc.dailyBudget)
                : '—'
          }
          sub={
            isLifetime
              ? daysRun > 0
                ? `over ${daysRun} day${daysRun === 1 ? '' : 's'}`
                : 'set start + end'
              : 'as last entered'
          }
        />
        <MetricBox
          label="Variance"
          value={
            variance != null
              ? `${variance >= 0 ? '+' : '-'}${fmt(Math.abs(variance))}`
              : '—'
          }
          sub={
            variancePct != null
              ? `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}% vs target`
              : 'set Target Spend'
          }
          color={varianceColor}
        />
      </div>
    </div>
  );
}

// ─── Budget Pacer panel ────────────────────────────────────────────────────
interface AccountPacing {
  // 'final' = a settled (frozen/closed) month's final variance (colored
  // over/under verdict). 'progress' = a LIVE month's plain spend-of-target
  // readout — deliberately NOT a pace verdict, so a mid-month "60% spent" can't
  // false-alarm as "under"; the per-ad pacing badges carry the on-pace judgment.
  mode: 'progress' | 'final';
  pct: number; // spent ÷ target × 100
  status: 'on-track' | 'over' | 'under' | 'neutral'; // 'progress' is always neutral
  spent: number; // account actual spend
  target: number; // effective spend target (client budget × markup + carryover)
  dayElapsed: number; // live only: day-of-month so the % reads in context
  dayTotal: number;
}

function PacerSpendTotals({
  base,
  added,
  actual,
  pacing,
}: {
  base: number;
  added: number;
  actual: number;
  // Account-wide pacing vs TIME-ADJUSTED expected spend (Change 9), aggregated
  // per-ad (finished ads contribute full target, mid-flight ads prorated).
  pacing?: AccountPacing | null;
}) {
  const isFinal = pacing?.mode === 'final';
  const isProgress = pacing?.mode === 'progress';
  // 'final' = a colored over/under verdict; 'progress' = a neutral readout.
  const pacingColor =
    pacing == null
      ? undefined
      : isProgress
        ? 'var(--muted-foreground)'
        : pacing.status === 'on-track'
          ? COLORS.success
          : pacing.status === 'over'
            ? COLORS.error
            : COLORS.warn;
  const pacingHeader = isFinal ? 'Final variance' : 'Spend progress';
  const pacingTitle = isFinal
    ? "Settled month: total actual spend vs the account's effective target (client budget × markup + carryover) — the final over/under, matching the Over/Under page."
    : "Account spend so far vs the month's effective target (client budget × markup + carryover), with day-of-month context. A plain progress readout — NOT a pace verdict; read the per-ad pacing badges for on-track health.";
  const pacingLabel =
    pacing == null
      ? ''
      : isFinal
        ? pacing.status === 'on-track'
          ? 'On target'
          : `${pacing.pct - 100 > 0 ? '+' : ''}${(pacing.pct - 100).toFixed(1)}% ${
              pacing.status === 'over' ? 'over' : 'under'
            }`
        : `${pacing.pct.toFixed(0)}% of target · day ${pacing.dayElapsed}/${pacing.dayTotal}`;
  return (
    <div className="flex flex-wrap gap-6 items-center justify-end">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Total Spend
        </div>
        <div className="text-lg font-bold text-[var(--foreground)]">
          {fmt(base + added)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Actual (Pacer)
        </div>
        <div className="text-lg font-bold" style={{ color: COLORS.lifetime }}>
          {fmt(actual)}
        </div>
      </div>
      {pacing && pacingColor && (
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {pacingHeader}
          </div>
          <span
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded mt-0.5"
            style={
              isProgress
                ? { background: 'var(--muted)', color: 'var(--foreground)' }
                : { background: `${pacingColor}22`, color: pacingColor }
            }
            title={pacingTitle}
          >
            {pacingLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function BudgetPacerPanel({
  plan,
  filters,
  onFiltersChange,
  currentUserId,
  onChange,
  totals,
  accountKey,
}: {
  plan: PacerPlan;
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  currentUserId: string | null;
  onChange: (p: PacerPlan) => void;
  totals: { base: number; added: number; actual: number };
  accountKey: string;
}) {
  const { confirm } = useLoomiDialog();
  // Per-ad expand state. Auto-seeded on first render (and on plan
  // changes) so rows that need attention are open by default; rep can
  // still toggle each manually.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const seededExpandedRef = useRef(false);

  const updateAd = (u: PacerAd) =>
    onChange({ ...plan, ads: plan.ads.map((a) => (a.id === u.id ? u : a)) });

  // Lazy-loaded Meta ad-set list for the per-row link picker. Fetched once on
  // first picker focus, then shared across every row.
  const [metaAdSets, setMetaAdSets] = useState<MetaAdSetOption[] | null>(null);
  const [adSetsLoading, setAdSetsLoading] = useState(false);
  const [adSetsError, setAdSetsError] = useState<string | null>(null);
  const loadMetaAdSets = useCallback(async () => {
    if (metaAdSets || adSetsLoading) return;
    setAdSetsLoading(true);
    setAdSetsError(null);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/meta-adsets`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAdSetsError(data?.error || 'Failed to load ad sets.');
        return;
      }
      setMetaAdSets(Array.isArray(data?.adSets) ? data.adSets : []);
    } catch {
      setAdSetsError('Failed to load ad sets.');
    } finally {
      setAdSetsLoading(false);
    }
  }, [accountKey, metaAdSets, adSetsLoading]);

  // Write a row's edited daily budget back to its linked Meta ad set. Returns a
  // result the row renders inline (the agency token needs `ads_management`, so
  // a read-only token surfaces Meta's permission error here).
  const pushDailyBudget = useCallback(
    async (adId: string, value: string): Promise<{ ok: boolean; text: string }> => {
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/push-budget?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adId, dailyBudget: value }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, text: data?.error || 'Push failed.' };
        return { ok: true, text: 'Pushed to Meta ✓' };
      } catch {
        return { ok: false, text: 'Push failed — network error.' };
      }
    },
    [accountKey, plan.period],
  );

  // §2: resolve a cross-month straddler (count its full run in its own month),
  // set a lifetime planned split, or clear. Optimistically updates the ad's
  // persisted resolution fields, then writes through the dedicated endpoint
  // (server-authoritative, so a re-sync or autosave can't clobber it).
  const resolveCrossMonth = useCallback(
    async (
      adId: string,
      action: 'apply_full_run' | 'split' | 'clear',
      splitMap?: Record<string, number>,
    ) => {
      // The CTA is disabled when frozen and the endpoint rejects a frozen
      // month (409), so no client-side readOnly guard is needed here.
      const prior = plan.ads.find((a) => a.id === adId);
      onChange({
        ...plan,
        ads: plan.ads.map((a) =>
          a.id === adId
            ? {
                ...a,
                fullRunAppliedToMonth:
                  action === 'apply_full_run' ? plan.period : null,
                lifetimeMonthSplit:
                  action === 'split' ? JSON.stringify(splitMap ?? {}) : null,
              }
            : a,
        ),
      });
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/resolve-cross-month?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adId,
              action,
              ...(action === 'split' ? { splitMap } : {}),
            }),
          },
        );
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          toast.error(d?.error || 'Failed to update cross-month resolution.');
          if (prior) {
            onChange({
              ...plan,
              ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
            });
          }
        }
      } catch {
        toast.error('Failed to update cross-month resolution — network error.');
        if (prior) {
          onChange({
            ...plan,
            ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
          });
        }
      }
    },
    [accountKey, plan, onChange],
  );

  const visibleAds = useMemo(
    () => applyFilters(plan.ads, filters, currentUserId),
    [plan.ads, filters, currentUserId],
  );
  const readOnly = usePacerReadOnly();

  // Account-wide pacing (§7): roll up per-ad pace over §0.2-ELIGIBLE ads only
  // (live, started, daily) so a completed run, a lifetime ad, or a not-yet-
  // started ad can't drag the account into a false under. Each eligible ad is
  // prorated against its OWN flight window (clampToMonth), never the calendar
  // month, and TOTAL SPEND is never the denominator. A frozen/closed month
  // isn't paced — it shows the settled final variance vs the effective target
  // (§0.1), the same number the Over/Under page reports.
  const accountPacing = useMemo<AccountPacing | null>(() => {
    const nowMs = Date.now();

    if (plan.frozen) {
      const gross =
        (num(plan.baseBudgetGoal) ?? 0) + (num(plan.addedBudgetGoal) ?? 0);
      const carry =
        (num(plan.baseCarryover) ?? 0) + (num(plan.addedCarryover) ?? 0);
      const target = effectiveSpendTarget(gross, effMarkupOf(plan.markup), carry);
      // §3: exclude any lifetime ad still in progress from BOTH sides — rare in
      // a settled month, but a flight extending past month-end can linger — so
      // this Final-variance badge matches the Over/Under + Reconciliation pages
      // (a no-op when no lifetime ad is mid-run).
      let ipLifeActual = 0;
      let ipLifeAlloc = 0;
      for (const ad of plan.ads) {
        if (!isLifetimeInProgress(ad, nowMs, plan.timeZone)) continue;
        ipLifeActual += effectiveActual(ad);
        ipLifeAlloc += num(ad.allocation) ?? 0;
      }
      const baseTarget = target - ipLifeAlloc;
      if (baseTarget <= 0) return null;
      const pct = ((totals.actual - ipLifeActual) / baseTarget) * 100;
      const delta = pct - 100;
      // Settled: report the exact final variance, no pacing tolerance band.
      const status =
        Math.abs(delta) < 0.5 ? 'on-track' : delta > 0 ? 'over' : 'under';
      return {
        mode: 'final',
        pct,
        status,
        spent: totals.actual - ipLifeActual,
        target: baseTarget,
        dayElapsed: 0,
        dayTotal: 0,
      };
    }

    // Live month: a plain spend-of-target progress readout — NOT a pace verdict.
    // The per-ad pacing badges carry the "are we on pace?" judgment; this just
    // answers "how much of the month's target have we spent, and how far into
    // the month are we" — neutral, so it can't false-alarm. (The §9 account-pace
    // alert still uses computeAccountPace server-side — a separate surface.)
    const gross =
      (num(plan.baseBudgetGoal) ?? 0) + (num(plan.addedBudgetGoal) ?? 0);
    const carry =
      (num(plan.baseCarryover) ?? 0) + (num(plan.addedCarryover) ?? 0);
    const target = effectiveSpendTarget(gross, effMarkupOf(plan.markup), carry);
    // §3 / §0.4: exclude in-progress lifetime ads from BOTH sides, exactly like
    // the frozen path + the Over/Under page — their variance books on completion,
    // so they aren't part of the settle-able spend progress yet (keeps the badge
    // agreeing with those surfaces).
    let ipLifeActual = 0;
    let ipLifeAlloc = 0;
    for (const ad of plan.ads) {
      if (!isLifetimeInProgress(ad, nowMs, plan.timeZone)) continue;
      ipLifeActual += effectiveActual(ad);
      ipLifeAlloc += num(ad.allocation) ?? 0;
    }
    const baseTarget = target - ipLifeAlloc;
    const baseSpent = totals.actual - ipLifeActual;
    if (baseTarget <= 0) return null;
    const now = new Date(nowMs);
    const [py, pm] = plan.period.split('-').map(Number);
    const dayTotal = new Date(py, pm, 0).getDate();
    const todayMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayElapsed =
      todayMonth === plan.period ? now.getDate() : todayMonth > plan.period ? dayTotal : 0;
    return {
      mode: 'progress',
      pct: (baseSpent / baseTarget) * 100,
      status: 'neutral',
      spent: baseSpent,
      target: baseTarget,
      dayElapsed,
      dayTotal,
    };
  }, [plan, totals.actual]);

  // Auto-expand needs-attention rows ONCE per mount so the rep lands on
  // the things that need work. Re-running on plan change would fight
  // the user's manual collapses; we instead seed once and let the user
  // own the state from there.
  useEffect(() => {
    if (seededExpandedRef.current) return;
    if (plan.ads.length === 0) return;
    seededExpandedRef.current = true;
    const next = new Set<string>();
    const nowMs = Date.now();
    plan.ads.forEach((ad) => {
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      const h = classifyPacerHealth(ad, c);
      if (h.state === 'over-budget' || h.state === 'overpacing') {
        next.add(ad.id);
      }
    });
    if (next.size > 0) setExpandedIds(next);
  }, [plan.ads, plan.timeZone]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Bulk "Set all dailies to Rec." — applies recommended daily to every
  // visible non-lifetime, non-stopped ad that has a valid recDaily.
  const bulkSetDailies = async () => {
    if (readOnly) return; // frozen month — bulk apply is disabled
    const nowMs = Date.now();
    const candidates = visibleAds.filter((ad) => {
      if (ad.budgetType !== 'Daily') return false;
      if (ad.adStatus === 'Off' || ad.adStatus === 'Completed Run') return false;
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      return c.daysLeft > 0 && c.budget > 0 && c.recDaily > 0;
    });
    if (candidates.length === 0) {
      toast.error('No visible ads have a recommended daily to apply');
      return;
    }
    // Guardrail: a >20% single-day budget change can reset Meta's learning
    // phase. Preview how many ads jump that much (from a non-zero current
    // daily) so a blind "set all" can't quietly reset several at once.
    const bigJumps = candidates.filter((ad) => {
      const current = num(ad.pacerDailyBudget) ?? 0;
      if (current <= 0) return false; // first-time set, not a learning-reset jump
      const rec = buildPacerCalc(ad, nowMs, plan.timeZone).recDaily;
      return Math.abs(rec - current) / current > 0.2;
    });
    const adWord = candidates.length === 1 ? 'ad' : 'ads';
    const message =
      bigJumps.length > 0
        ? `This will change ${candidates.length} ${adWord}. ${bigJumps.length} ${
            bigJumps.length === 1 ? 'is a' : 'are'
          } >20% jump${bigJumps.length === 1 ? '' : 's'} — large changes can reset Meta's learning phase: ${bigJumps
            .map((a) => a.name || 'Untitled')
            .join(', ')}.`
        : `Apply the recommended daily budget to ${candidates.length} visible ${adWord}?`;
    const ok = await confirm({
      title: 'Set dailies to recommended',
      message,
      confirmLabel: `Apply to ${candidates.length} ${adWord}`,
    });
    if (!ok) return;
    const candidateIds = new Set(candidates.map((a) => a.id));
    onChange({
      ...plan,
      ads: plan.ads.map((ad) => {
        if (!candidateIds.has(ad.id)) return ad;
        const c = buildPacerCalc(ad, nowMs, plan.timeZone);
        return {
          ...ad,
          pacerDailyBudget: c.recDaily.toFixed(2),
        };
      }),
    });
    toast.success(
      `Set daily budget on ${candidates.length} ad${candidates.length === 1 ? '' : 's'} to recommended`,
    );
  };

  // Budget Log + Change Log moved to the account scope row (lifted to the
  // parent), so they're no longer rendered from this panel.
  const bulkDailyButton = readOnly ? null : (
    <button
      type="button"
      onClick={bulkSetDailies}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
      title="Set every visible ad's daily budget to its recommended value"
    >
      <BoltIcon className="w-3.5 h-3.5" />
      Set all dailies to Rec.
    </button>
  );

  if (plan.ads.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
            <ChartBarIcon className="w-4 h-4" />
            Spend Pacing
          </h2>
          <div className="flex items-center gap-4 flex-wrap">
            <PacerSpendTotals
              base={totals.base}
              added={totals.added}
              actual={totals.actual}
            />
          </div>
        </div>
        <div className="glass-section-card rounded-xl px-6 py-12 text-center">
          <ClipboardDocumentListIcon className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <div className="text-sm text-[var(--foreground)] font-medium mb-1">
            No ads in your plan yet.
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            Add ads in the Ad Planner tab and they'll appear here automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ChartBarIcon className="w-4 h-4" />
          {`Spend Pacing (${visibleAds.length}${
            visibleAds.length !== plan.ads.length ? ` of ${plan.ads.length}` : ''
          } ad${plan.ads.length !== 1 ? 's' : ''})`}
        </h2>
        <div className="flex items-center gap-4 flex-wrap">
          <PacerSpendTotals
            base={totals.base}
            added={totals.added}
            actual={totals.actual}
            pacing={accountPacing}
          />
        </div>
      </div>
      {(() => {
        // Reassurance that an odd-looking total is explained — driven by the
        // user's MANUAL cross-month marks (no auto-detection): a billed
        // cross-month ad counts its full run in the over/under though only its
        // in-month slice lands in the month total.
        const crossMonthCount = visibleAds.filter(
          (a) => a.fullRunAppliedToMonth != null,
        ).length;
        if (crossMonthCount === 0) return null;
        return (
          <div className="mb-3 text-[11px]" style={{ color: '#38bdf8' }}>
            {crossMonthCount} ad{crossMonthCount === 1 ? '' : 's'} billed
            cross-month — the full run is counted in the over/under though part
            spent in another month, so the monthly total can differ (expand a
            flagged row for details).
          </div>
        );
      })()}
      {(() => {
        // §2a: how many straddlers have been resolved (full run counted whole).
        const fullRunCount = visibleAds.filter(
          (a) => a.fullRunAppliedToMonth != null,
        ).length;
        if (fullRunCount === 0) return null;
        return (
          <div className="mb-3 text-[11px]" style={{ color: '#38bdf8' }}>
            {fullRunCount} ad{fullRunCount === 1 ? '' : 's'} with full-run applied
            — counted whole in this month, not split across the boundary.
          </div>
        );
      })()}
      <FilterStatus
        filters={filters}
        onClear={() => onFiltersChange(EMPTY_FILTERS)}
        filteredCount={visibleAds.length}
        totalCount={plan.ads.length}
      />
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="m-0 text-[11px] text-[var(--muted-foreground)] max-w-[640px]">
          Click any row to expand. Rows that need attention (overpacing or
          over-budget) are auto-expanded; the rest stay collapsed.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              setExpandedIds(new Set(visibleAds.map((a) => a.id)))
            }
            className="text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setExpandedIds(new Set())}
            className="text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Collapse all
          </button>
          {bulkDailyButton}
        </div>
      </div>
      {visibleAds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center text-sm text-[var(--muted-foreground)]">
          No ads match the current filters.
        </div>
      ) : (
        visibleAds.map((ad) => (
          <PacerRow
            key={`${ad.id}-${ad.budgetType}`}
            ad={ad}
            index={plan.ads.findIndex((a) => a.id === ad.id)}
            timeZone={plan.timeZone}
            onActualChange={(v) => updateAd({ ...ad, pacerActual: v })}
            onDailyBudgetChange={(v) => updateAd({ ...ad, pacerDailyBudget: v })}
            expanded={expandedIds.has(ad.id)}
            onToggleExpanded={() => toggleExpanded(ad.id)}
            adSets={metaAdSets}
            adSetsLoading={adSetsLoading}
            adSetsError={adSetsError}
            onLoadAdSets={loadMetaAdSets}
            onLinkChange={(adSetId) =>
              updateAd({
                ...ad,
                metaObjectId: adSetId,
                metaObjectType: adSetId ? 'adset' : null,
              })
            }
            onMuteToggle={() =>
              updateAd({ ...ad, alertsMuted: !ad.alertsMuted })
            }
            onMarkOff={() => updateAd({ ...ad, adStatus: 'Off' })}
            onPushDailyBudget={(value) => pushDailyBudget(ad.id, value)}
            onResolveCrossMonth={(action, splitMap) =>
              resolveCrossMonth(ad.id, action, splitMap)
            }
          />
        ))
      )}
    </div>
  );
}

// ─── Summary panel (top-level Summary tab) ─────────────────────────────────
function SummaryPanel({ plan }: { plan: PacerPlan }) {
  const calcs = useMemo(
    () => plan.ads.map((ad) => buildAdCalc(ad, Date.now(), plan.timeZone)),
    [plan],
  );
  const totalProjected = calcs.reduce((s, c) => s + c.projected, 0);
  const totalActual = calcs.reduce((s, c) => s + (c.actual ?? 0), 0);
  const totalTarget = calcs.reduce((s, c) => s + (c.target ?? 0), 0);
  const baseGoal = num(plan.baseBudgetGoal);
  const addedGoal = num(plan.addedBudgetGoal);
  const combinedGoal =
    baseGoal != null || addedGoal != null ? (baseGoal ?? 0) + (addedGoal ?? 0) : null;

  if (plan.ads.length === 0) {
    return (
      <div className="glass-section-card rounded-xl px-6 py-12 text-center">
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">No ads yet</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Add at least one ad in the Budgeting tab to see a summary.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-section-card rounded-xl px-5 py-4">
      <SectionLabel icon={<TableCellsIcon className="w-3 h-3" />} text="Summary Table" />
      {(baseGoal != null || addedGoal != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Base Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.base }}>
              {baseGoal != null ? fmt(baseGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Added Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.added }}>
              {addedGoal != null ? fmt(addedGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Combined Total
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--foreground)]">
              {combinedGoal != null ? fmt(combinedGoal) : '—'}
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                'Ad Name',
                'Type',
                'Source',
                'Date Range',
                'Days',
                'Budget',
                'Projected',
                'Actual',
                'Target',
                'Rec. Daily',
                'Δ Budget',
              ].map((h) => (
                <th
                  key={h}
                  className="px-2.5 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calcs.map((c, i) => (
              <tr key={c.ad.id} className="border-b border-[var(--border)]">
                <td className="px-2.5 py-2.5 text-[var(--foreground)] max-w-[160px] truncate">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle"
                    style={{ background: AD_COLORS[i % AD_COLORS.length] }}
                  />
                  {c.ad.name}
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: c.isLifetime
                        ? 'rgba(167,139,250,0.18)'
                        : 'rgba(56,189,248,0.18)',
                      color: c.isLifetime ? COLORS.lifetime : COLORS.daily,
                    }}
                  >
                    {c.ad.budgetType}
                  </span>
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: sourceTint(c.ad.budgetSource),
                      color: sourceColor(c.ad.budgetSource),
                    }}
                  >
                    {sourceLabel(c.ad.budgetSource)}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)] whitespace-nowrap">
                  {c.ad.flightStart && c.ad.flightEnd
                    ? `${fmtFullDate(c.ad.flightStart)} → ${fmtFullDate(c.ad.flightEnd)}`
                    : '—'}
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)]">
                  {c.days > 0 ? c.days : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{ color: c.isLifetime ? COLORS.lifetime : COLORS.daily }}
                >
                  {fmt(c.totalBudget)}
                  <span className="ml-1 text-[9px] text-[var(--muted-foreground)]">
                    {c.isLifetime ? 'total' : '/day'}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--foreground)]">
                  {fmt(c.projected)}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.actual != null ? COLORS.lifetime : 'var(--muted-foreground)',
                    opacity: c.actual != null ? 1 : 0.6,
                  }}
                >
                  {c.actual != null ? fmt(c.actual) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.target != null ? 'var(--foreground)' : 'var(--muted-foreground)',
                    opacity: c.target != null ? 1 : 0.6,
                  }}
                >
                  {c.target != null ? fmt(c.target) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color:
                      c.recDaily != null ? COLORS.success : 'var(--muted-foreground)',
                    opacity: c.recDaily != null ? 1 : 0.6,
                  }}
                >
                  {c.isLifetime ? (
                    <span className="text-[var(--muted-foreground)]">n/a</span>
                  ) : c.recDaily != null ? (
                    fmt(c.recDaily)
                  ) : (
                    '—'
                  )}
                </td>
                <td
                  className="px-2.5 py-2.5 font-bold"
                  style={{
                    color:
                      c.delta == null
                        ? 'var(--muted-foreground)'
                        : c.delta > 0
                          ? COLORS.success
                          : c.delta < 0
                            ? COLORS.error
                            : 'var(--foreground)',
                    opacity: c.delta == null ? 0.6 : 1,
                  }}
                >
                  {c.delta != null ? `${c.delta >= 0 ? '+' : ''}${fmt(c.delta)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)]">
              <td
                colSpan={5}
                className="px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Totals
              </td>
              <td className="px-2.5 py-2.5 text-[9px] text-[var(--muted-foreground)]">
                —
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.daily }}
              >
                {fmt(totalProjected)}
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.lifetime }}
              >
                {totalActual > 0 ? fmt(totalActual) : '—'}
              </td>
              <td className="px-2.5 py-2.5 font-bold text-[var(--foreground)]">
                {totalTarget > 0 ? fmt(totalTarget) : '—'}
              </td>
              <td colSpan={2} />
            </tr>
            {combinedGoal != null && (
              <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                <td
                  colSpan={5}
                  className="px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Combined Budget Goal
                </td>
                <td colSpan={6} className="px-2.5 py-2.5">
                  <span className="text-[var(--foreground)] font-bold">
                    {fmt(Math.round(combinedGoal * effMarkupOf(plan.markup) * 100) / 100)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> actual / </span>
                  <span style={{ color: COLORS.daily }} className="font-bold">
                    {fmt(combinedGoal)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> gross client</span>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Reconciliation panel (Phase 2b) ───────────────────────────────────────
interface ReconMonth {
  period: string;
  state: 'current' | 'grace' | 'closed' | 'future';
  isBackfilled: boolean;
  hasTarget: boolean;
  hasActual: boolean;
  clientBudget: number;
  spendTarget: number;
  adjustedSpendTarget: number;
  actual: number;
  variance: number;
  carryover: number;
  exceedsThreshold: boolean;
  appliedOut: number;
  unapplied: number;
  appliedIn: number;
  // §3: month has a lifetime ad still running — excluded from the over/under
  // base (books once on completion); drives the 'lifetime · in progress' badge.
  hasLifetimeInProgress: boolean;
  // CM4: per-ad over/under contributions for this month — the row drill-down.
  ads?: {
    name: string;
    inMonthSpend: number;
    billedActual: number;
    contribution: number;
    klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
  }[];
}
interface CarryoverApplication {
  id: string;
  sourceMonth: string;
  targetMonth: string;
  bucket: 'base' | 'added';
  amount: number;
  appliedAt: string;
}
interface ReconData {
  year: number;
  markup: number;
  targetPeriod: string;
  months: ReconMonth[];
  ytdVariance: number;
  ytdCarryover: number;
  ytdUnapplied: number;
  // §4: lifetime drift incl. the in-progress live month (health gauge), and the
  // settled months still carrying unapplied over/under (named in the UI).
  ytdVarianceInclLive: number;
  unappliedMonths: string[];
  appliedThisMonth: { base: number; added: number; total: number };
  // §5: individual ledger entries, newest first — powers both-ends provenance.
  applications: CarryoverApplication[];
}

/**
 * Year reconciliation: per-month over/under (tracked + backfilled), a YTD net
 * still to reconcile, and apply/undo controls. Applying rolls a month's (or all
 * months') over/under into the live month's bucket via the ledger, correcting
 * the account's running annual variance.
 */
function ReconciliationPanel({ accountKey }: { accountKey: string }) {
  const [year, setYear] = useState<number>(() =>
    Number(currentPeriod().slice(0, 4)),
  );
  const [data, setData] = useState<ReconData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bucket, setBucket] = useState<'base' | 'added'>('base');
  const [backfilling, setBackfilling] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // CM4: which month rows are expanded to their per-ad variance breakdown.
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setData(null);
    setLoadError(null);
    fetch(`/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}`)
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
        }
        return r.json();
      })
      .then((json: ReconData) => setData(json))
      .catch((err) =>
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load reconciliation.',
        ),
      );
  }, [accountKey, year]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setActionError(null);
    try {
      const r = await fetch(
        `/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      setData(json as ReconData);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const backfill = async () => {
    setBackfilling(true);
    setActionError(null);
    try {
      const r = await fetch(
        `/api/meta-ads-pacer/${accountKey}/backfill-history?year=${year}`,
        { method: 'POST' },
      );
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Backfill failed.');
    } finally {
      setBackfilling(false);
    }
  };

  // variance > 0 = overspent (warn); < 0 = underspent (lifetime/blue).
  const overUnder = (v: number) =>
    Math.abs(v) < 0.005
      ? { text: 'On target', color: 'var(--muted-foreground)' }
      : v > 0
        ? { text: `${fmt(v)} over`, color: COLORS.warn }
        : { text: `${fmt(-v)} under`, color: COLORS.lifetime };

  const net = data?.ytdUnapplied ?? 0;
  const netReconciled = Math.abs(net) < 0.005;
  const canApply = !!data?.targetPeriod && !netReconciled;
  // §4: the health-gauge total (lifetime drift incl. the in-progress live
  // month, variance convention) — distinct from `net` (the settle-able queue).
  const inclLive = data?.ytdVarianceInclLive ?? 0;
  const inclLiveGauge = overUnder(inclLive);
  // §4: name the settled months still carrying unapplied over/under.
  const unappliedMonthsLabel = (data?.unappliedMonths ?? [])
    .map((p) =>
      new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString(
        'en-US',
        { month: 'short' },
      ),
    )
    .join(', ');

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <InvestmentIcon className="w-4 h-4" />
          Reconciliation
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="px-2.5 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label="Previous year"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-semibold text-[var(--foreground)] tabular-nums">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= Number(currentPeriod().slice(0, 4))}
              className="px-2.5 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next year"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={backfill}
            disabled={backfilling}
            title="Pull account-total monthly spend from Meta for pre-tool months this year"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${backfilling ? 'animate-spin' : ''}`} />
            {backfilling ? 'Backfilling…' : 'Backfill historical spend'}
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="text-center py-12 text-xs text-red-400">{loadError}</div>
      ) : !data ? (
        <div className="text-center py-12 text-xs text-[var(--muted-foreground)]">
          Loading…
        </div>
      ) : (
        <>
          {/* YTD net + apply-all controls */}
          <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex items-start justify-between gap-5 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {year} net still to reconcile
              </div>
              <div
                className="text-3xl font-bold tabular-nums leading-tight mt-1"
                style={{
                  color: netReconciled
                    ? COLORS.success
                    : net > 0
                      ? COLORS.lifetime
                      : COLORS.warn,
                }}
              >
                {netReconciled
                  ? 'Fully reconciled'
                  : `${net > 0 ? '' : '−'}${fmt(Math.abs(net))}`}
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-1">
                {netReconciled
                  ? 'No outstanding over/under across settled months.'
                  : net > 0
                    ? `Underspent ${unappliedMonthsLabel ? `across ${unappliedMonthsLabel}` : 'across settled months'} — apply to add ${fmt(net)} to ${data.targetPeriod ? fmtPeriodLong(data.targetPeriod) : 'the live month'}.`
                    : `Overspent ${unappliedMonthsLabel ? `across ${unappliedMonthsLabel}` : 'across settled months'} — apply to pull ${fmt(-net)} from ${data.targetPeriod ? fmtPeriodLong(data.targetPeriod) : 'the live month'}.`}
              </div>
              {data.appliedThisMonth.total !== 0 && data.targetPeriod && (
                <div className="text-[11px] text-[var(--muted-foreground)] mt-2 flex items-center gap-2 flex-wrap">
                  <span>
                    Applied into {fmtPeriodLong(data.targetPeriod)}:{' '}
                    <span className="font-semibold text-[var(--foreground)] tabular-nums">
                      {data.appliedThisMonth.total > 0 ? '+' : '−'}
                      {fmt(Math.abs(data.appliedThisMonth.total))}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => post({ type: 'unapply' }, 'clear-all')}
                    disabled={busy === 'clear-all'}
                    className="text-[var(--primary)] hover:underline disabled:opacity-50"
                  >
                    {busy === 'clear-all' ? 'Clearing…' : 'Clear all'}
                  </button>
                </div>
              )}
              {/* §4: health-gauge total — lifetime drift INCLUDING the
                  in-progress live month. Deliberately distinct from the
                  settle-able "net still to reconcile" above (which excludes the
                  open month) so the two can't be confused: one is the action
                  queue, this is the overall over/under reading. */}
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Net variance · incl. live month
                </div>
                <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                  <span
                    className="text-base font-semibold tabular-nums"
                    style={{ color: inclLiveGauge.color }}
                  >
                    {inclLiveGauge.text}
                  </span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    health gauge — total drift including{' '}
                    {data.targetPeriod
                      ? `${fmtPeriodLong(data.targetPeriod)} in progress`
                      : 'the live month'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
                {(['base', 'added'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBucket(b)}
                    className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                      bucket === b
                        ? 'bg-[var(--primary)] text-white'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {b === 'base' ? 'Base' : 'Added'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => post({ type: 'apply-all', bucket }, 'apply-all')}
                disabled={!canApply || busy === 'apply-all'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'apply-all'
                  ? 'Applying…'
                  : `Apply all unapplied → ${bucket === 'base' ? 'Base' : 'Added'}`}
              </button>
              <span className="text-[10px] text-[var(--muted-foreground)] text-right max-w-[200px]">
                Carryover lands in the {bucket === 'base' ? 'Base' : 'Added'} bucket of the live month.
              </span>
            </div>
          </div>

          {actionError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
              {actionError}
            </div>
          )}

          {/* Per-month table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="text-left font-semibold px-3 py-2.5">Month</th>
                  <th className="text-right font-semibold px-3 py-2.5">Spend Target</th>
                  <th className="text-right font-semibold px-3 py-2.5">Actual</th>
                  <th className="text-right font-semibold px-3 py-2.5">Over / Under</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-[200px]">Reconcile</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[var(--muted-foreground)]">
                      No months to show for {year} yet.
                    </td>
                  </tr>
                )}
                {data.months.map((m) => {
                  const isLive = m.period === data.targetPeriod;
                  const noData = !m.hasActual && !m.hasTarget;
                  const needsTarget = m.isBackfilled && !m.hasTarget;
                  const applied = Math.abs(m.appliedOut) >= 0.005;
                  const ou = overUnder(m.variance);
                  const hasAdDetail = (m.ads?.length ?? 0) > 0;
                  const expanded = expandedMonths.has(m.period);
                  return (
                    <Fragment key={m.period}>
                    <tr
                      className={`border-b border-[var(--border)] last:border-0 ${
                        isLive ? 'bg-[var(--primary)]/5' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                          {hasAdDetail && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMonths((s) => {
                                  const next = new Set(s);
                                  if (next.has(m.period)) next.delete(m.period);
                                  else next.add(m.period);
                                  return next;
                                })
                              }
                              aria-label={expanded ? 'Hide ad breakdown' : 'Show ad breakdown'}
                              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
                            >
                              <ChevronRightIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {fmtPeriodLong(m.period)}
                          {isLive && (
                            <span className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)]">
                              Live
                            </span>
                          )}
                          {m.isBackfilled && (
                            <span
                              className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 bg-[var(--muted)] text-[var(--muted-foreground)]"
                              title="Pre-tool month — actual pulled from Meta account spend"
                            >
                              Backfilled
                            </span>
                          )}
                          {m.hasLifetimeInProgress && (
                            <span
                              className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5"
                              style={{
                                background: 'rgba(167,139,250,0.15)',
                                color: COLORS.lifetime,
                              }}
                              title="A lifetime ad is still running this month — excluded from the over/under base (its single variance books once when the run completes). Its spend still shows in the Pacer's total spend."
                            >
                              Lifetime in progress
                            </span>
                          )}
                        </div>
                        {isLive && (
                          <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                            target month — over/under lands here
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {needsTarget ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[var(--muted-foreground)]">$</span>
                            <input
                              value={drafts[m.period] ?? ''}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [m.period]: e.target.value }))
                              }
                              placeholder="budget"
                              inputMode="decimal"
                              className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-right text-xs text-[var(--foreground)]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                post(
                                  {
                                    type: 'set-target',
                                    period: m.period,
                                    clientBudget: drafts[m.period] ?? '',
                                  },
                                  `target:${m.period}`,
                                )
                              }
                              disabled={busy === `target:${m.period}`}
                              className="text-[10px] text-[var(--primary)] hover:underline disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        ) : m.hasTarget || m.appliedIn !== 0 ? (
                          <>
                            <div className="text-[var(--foreground)] font-semibold">
                              {fmt(m.adjustedSpendTarget)}
                            </div>
                            {m.hasTarget && (
                              <div className="text-[9px] text-[var(--muted-foreground)]">
                                {fmt(m.clientBudget)} × {Math.round(data.markup * 100)}%
                              </div>
                            )}
                            {m.appliedIn !== 0 && (
                              <div
                                className="text-[9px]"
                                style={{ color: COLORS.lifetime }}
                                title="Carryover applied INTO this month from a prior month's over/under (adjusts this month's target; the client budget is unchanged)."
                              >
                                ← {m.appliedIn > 0 ? '+' : '−'}
                                {fmt(Math.abs(m.appliedIn))} from{' '}
                                {(() => {
                                  const srcs = Array.from(
                                    new Set(
                                      (data.applications ?? [])
                                        .filter((a) => a.targetMonth === m.period)
                                        .map((a) => a.sourceMonth),
                                    ),
                                  );
                                  return srcs.length
                                    ? srcs.map((s) => fmtPeriodLong(s)).join(', ')
                                    : 'a prior month';
                                })()}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                        {m.hasActual ? fmt(m.actual) : <span className="text-[var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {noData || !m.hasTarget || !m.hasActual ? (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        ) : (
                          <span style={{ color: ou.color }} className="font-semibold">
                            {ou.text}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isLive ? (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            In progress
                          </span>
                        ) : applied ? (
                          <div className="flex items-center justify-end gap-2">
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold"
                              style={{ color: COLORS.success }}
                              title={`This month's over/under was applied into ${
                                data.targetPeriod
                                  ? fmtPeriodLong(data.targetPeriod)
                                  : 'the live month'
                              }`}
                            >
                              <CheckIcon className="w-3 h-3" />
                              Applied {m.appliedOut >= 0 ? '+' : '−'}
                              {fmt(Math.abs(m.appliedOut))} →{' '}
                              {(() => {
                                const tgts = Array.from(
                                  new Set(
                                    (data.applications ?? [])
                                      .filter((a) => a.sourceMonth === m.period)
                                      .map((a) => a.targetMonth),
                                  ),
                                );
                                return tgts.length
                                  ? tgts.map((t) => fmtPeriodLong(t)).join(', ')
                                  : data.targetPeriod
                                    ? fmtPeriodLong(data.targetPeriod)
                                    : 'live month';
                              })()}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                post(
                                  { type: 'unapply', sourceMonth: m.period },
                                  `unapply:${m.period}`,
                                )
                              }
                              disabled={busy === `unapply:${m.period}`}
                              className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline disabled:opacity-50"
                            >
                              {busy === `unapply:${m.period}` ? '…' : 'Undo'}
                            </button>
                          </div>
                        ) : noData ? (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            No data
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded && hasAdDetail && (
                      <tr className={isLive ? 'bg-[var(--primary)]/5' : ''}>
                        <td colSpan={5} className="px-3 pb-3 pt-0">
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 overflow-hidden">
                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]">
                              Variance by ad
                            </div>
                            <div className="divide-y divide-[var(--border)]/60">
                              {(m.ads ?? []).map((av, i) => {
                                const amtColor =
                                  av.klass === 'lifetime-in-progress'
                                    ? COLORS.lifetime
                                    : av.klass === 'billed-cross-month'
                                      ? '#38bdf8'
                                      : overUnder(av.contribution).color;
                                return (
                                  <div
                                    key={`${m.period}-${i}`}
                                    className="flex items-center justify-between gap-3 px-3 py-1.5"
                                  >
                                    <div className="min-w-0 flex items-center gap-2">
                                      <span className="text-[11px] text-[var(--foreground)] truncate">
                                        {av.name || 'Untitled ad'}
                                      </span>
                                      {av.klass === 'billed-cross-month' && (
                                        <span
                                          className="text-[9px] font-semibold flex-shrink-0"
                                          style={{ color: '#38bdf8' }}
                                          title="Billed in this month though it ran across months — the over/under counts its full run; only part spent this month."
                                        >
                                          billed cross-month
                                        </span>
                                      )}
                                      {av.klass === 'lifetime-in-progress' && (
                                        <span
                                          className="text-[9px] font-semibold flex-shrink-0"
                                          style={{ color: COLORS.lifetime }}
                                          title="Lifetime ad still running — its spend is held out of the over/under until the run completes."
                                        >
                                          lifetime · books on completion
                                        </span>
                                      )}
                                    </div>
                                    <span
                                      className="text-[11px] font-semibold tabular-nums flex-shrink-0"
                                      style={{ color: amtColor }}
                                    >
                                      {av.klass === 'lifetime-in-progress'
                                        ? `${fmt(av.inMonthSpend)} held`
                                        : `${av.contribution >= 0 ? '+' : '−'}${fmt(Math.abs(av.contribution))}`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-[var(--muted-foreground)] leading-relaxed">
            Over/under is measured against the margin-adjusted spend target
            (client budget × {Math.round(data.markup * 100)}%). Applying a month
            rolls its over/under into the live month&apos;s budget via an
            auditable ledger entry — it never edits the original month&apos;s
            billing record. Backfilled months pull account-total spend from Meta;
            enter their client budget to compute a variance.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Over/Under Spend panel ────────────────────────────────────────────────
interface YearMonthRow {
  period: string;
  clientBudget: number; // gross client budget (Base + Added) — context only
  spendTarget: number; // margin-adjusted target (client budget × markup)
  actual: number; // actual spend
}

interface MonthAd {
  id: string;
  name: string;
  budgetSource: 'base' | 'added' | 'split';
  budgetType: 'Daily' | 'Lifetime';
  // When budgetSource === 'split', this is the dollar portion of
  // `allocation` drawn from Base. The rest comes from Added. Spend
  // apportions proportionally for the Over/Under math.
  splitBaseAmount: string | null;
  allocation: number;
  actual: number;
  // §3: a lifetime ad still running — excluded from the over/under base (both
  // its actual slice AND its allocation) while in progress; books its single
  // variance once it completes. Still counted in total month spend.
  lifetimeInProgress: boolean;
  // §2a: the YYYY-MM the ad's full run was counted in (resolved straddler), or
  // null. Drives the 'full run → applied to [month]' badge on the row.
  fullRunAppliedToMonth: string | null;
  // Cross-month clarity: this ad's over/under contribution + WHY it differs from
  // plan. Computed server-side (classifyAdVariance) so every surface agrees.
  variance?: {
    inMonthSpend: number;
    billedActual: number;
    contribution: number;
    klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
  };
}

interface MonthPlanData {
  baseBudgetGoal: number;
  addedBudgetGoal: number;
  // Per-account markup override; null = fall back to the agency default markup.
  // Needed for the Over/Under math because pacerActual is in actual-spend
  // dollars while the budget goals are gross client dollars.
  markup: number | null;
  // All-accounts mode only: a pre-summed spend target where each account's own
  // markup was already applied before summing (a single cross-account markup
  // would be wrong). When set, it's the variance basis instead of
  // gross × markup. null in single-account mode (computed from the goals).
  spendTargetOverride: number | null;
  ads: MonthAd[];
}

function daysInPeriod(period: string): number {
  if (!isValidPeriod(period)) return 30;
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function daysElapsedInPeriod(period: string): number {
  if (!isValidPeriod(period)) return 0;
  const [y, m] = period.split('-').map(Number);
  const today = new Date();
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  if (today < monthStart) return 0;
  if (today > monthEnd) return monthEnd.getDate();
  return today.getDate();
}

function ComparePanel({ accountKey }: { accountKey: string | null }) {
  // §6: the Over/Under page is a within-month, per-ad diagnostic only. Everything
  // cross-month/annual (running balance, adjusted targets, apply/undo, audit
  // trail) lives on the Reconciliation page, which owns it — so the old "Year"
  // tab here (an unadjusted, no-reconcile duplicate of that table) is removed.
  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ScaleIcon className="w-4 h-4" />
          {accountKey ? 'Over/Under Spend' : 'Over/Under Spend — all accounts'}
        </h2>
      </div>
      <OverUnderMonthView accountKey={accountKey} />
    </div>
  );
}

function OverUnderMonthView({ accountKey }: { accountKey: string | null }) {
  const [period, setPeriod] = useState<string>(() => currentPeriod());
  const [data, setData] = useState<MonthPlanData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError(null);

    const url = accountKey
      ? `/api/meta-ads-pacer/${accountKey}?period=${period}`
      : `/api/meta-ads-pacer/year-summary?year=${period.slice(0, 4)}`;

    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (accountKey) {
          const ads = Array.isArray(json?.ads) ? json.ads : [];
          setData({
            baseBudgetGoal: num(json?.baseBudgetGoal) ?? 0,
            addedBudgetGoal: num(json?.addedBudgetGoal) ?? 0,
            markup:
              typeof json?.markup === 'number' && Number.isFinite(json.markup)
                ? json.markup
                : null,
            // Single account: target is derived from goals × markup below.
            spendTargetOverride: null,
            ads: ads.map(
              (a: {
                id: string;
                name?: string | null;
                budgetSource?: string;
                budgetType?: string;
                period?: string;
                splitBaseAmount?: string | null;
                allocation?: string | null;
                pacerActual?: string | null;
                pacerRunSpend?: string | null;
                fullRunAppliedToMonth?: string | null;
                lifetimeInProgress?: boolean;
                variance?: {
                  inMonthSpend: number;
                  billedActual: number;
                  contribution: number;
                  klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
                };
              }) => {
                const eff = { ...a, period: a.period ?? period };
                return {
                  id: a.id,
                  name: a.name || 'Untitled Ad',
                  budgetSource:
                    a.budgetSource === 'split'
                      ? ('split' as const)
                      : a.budgetSource === 'added'
                        ? ('added' as const)
                        : ('base' as const),
                  budgetType:
                    a.budgetType === 'Lifetime'
                      ? ('Lifetime' as const)
                      : ('Daily' as const),
                  splitBaseAmount: a.splitBaseAmount ?? null,
                  allocation: effectiveTarget(eff),
                  // Display/total = what actually spent THIS month (the slice);
                  // the over/under uses billedActual from `variance` below.
                  actual: a.variance?.inMonthSpend ?? effectiveActual(eff),
                  lifetimeInProgress: a.lifetimeInProgress === true,
                  fullRunAppliedToMonth: a.fullRunAppliedToMonth ?? null,
                  variance: a.variance,
                };
              },
            ),
          });
        } else {
          // All-accounts mode — fall back to the year-summary aggregate
          // for the selected month. No per-ad breakdown available here, but
          // the endpoint already applied each account's own markup to build
          // spendTarget, so we use that directly as the variance basis rather
          // than re-applying one blanket markup to the cross-account gross.
          const months: YearMonthRow[] = Array.isArray(json?.months) ? json.months : [];
          const row = months.find((m) => m.period === period);
          setData({
            baseBudgetGoal: row?.clientBudget ?? 0,
            addedBudgetGoal: 0,
            markup: null,
            spendTargetOverride: row?.spendTarget ?? 0,
            ads: row
              ? [
                  {
                    id: 'aggregate',
                    name: 'All tracked ads (aggregate)',
                    budgetSource: 'base' as const,
                    budgetType: 'Daily' as const,
                    splitBaseAmount: null,
                    allocation: row.clientBudget,
                    actual: row.actual,
                    lifetimeInProgress: false,
                    fullRunAppliedToMonth: null,
                  },
                ]
              : [],
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] over/under month load failed', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  // Budget goals are stored gross; pacerActual is actual-spend. Convert
  // budget through the account's effective markup so the comparison is
  // apples-to-apples (everything in actual-spend dollars).
  const effectiveMarkup = effMarkupOf(data?.markup);
  const budgetGross = data ? data.baseBudgetGoal + data.addedBudgetGoal : 0;
  // All-accounts mode supplies a pre-summed, per-account-correct target;
  // single-account mode derives it from this account's goals × markup.
  const budgetActual =
    data?.spendTargetOverride != null
      ? data.spendTargetOverride
      : budgetGross * effectiveMarkup;
  // The split (X2): two reconciling totals.
  //  • totalInMonth — what actually spent THIS calendar month (every ad's
  //    in-month slice). The honest "total spend".
  //  • overUnderActual — what the over/under is BILLED on: the full run for an
  //    ad the user billed cross-month (variance.billedActual), and $0 for an
  //    in-progress lifetime ad (§3, books on completion) — so both are handled
  //    without a separate subtraction.
  const allAds = data?.ads ?? [];
  const inProgressLifetime = allAds.filter((a) => a.lifetimeInProgress);
  const ipLifeAlloc = inProgressLifetime.reduce((s, a) => s + a.allocation, 0);
  const totalInMonth = allAds.reduce((s, a) => s + a.actual, 0);
  const overUnderActual = allAds.reduce(
    (s, a) => s + (a.variance?.billedActual ?? a.actual),
    0,
  );
  const daysIn = daysInPeriod(period);
  const daysElapsed = daysElapsedInPeriod(period);
  // Target nets out an in-progress lifetime ad's allocation (§3).
  const shouldHaveSpent = budgetActual - ipLifeAlloc;
  const variance = overUnderActual - shouldHaveSpent;

  // What explains total ≠ over/under basis: cross-month-billed runs (billed here
  // but spent in another month) + in-progress lifetime spend (spent this month,
  // not yet booked).
  const billedElsewhere = allAds.reduce(
    (s, a) =>
      a.variance?.klass === 'billed-cross-month'
        ? s + (a.variance.billedActual - a.variance.inMonthSpend)
        : s,
    0,
  );
  const heldOutLifetime = inProgressLifetime.reduce((s, a) => s + a.actual, 0);
  const crossMonthCount = allAds.filter(
    (a) => a.variance?.klass === 'billed-cross-month',
  ).length;

  const varianceColor = (v: number) =>
    Math.abs(v) < 0.005
      ? COLORS.success
      : v > 0
        ? COLORS.error
        : COLORS.warn;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Previous month"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold px-3 min-w-[8rem] text-center">
            {fmtPeriodLong(period)}
          </span>
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Next month"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPeriod(currentPeriod())}
            className="ml-1 px-2 py-1 text-[10px] font-medium rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Today
          </button>
        </div>
        <div className="text-[10px] text-[var(--muted-foreground)]">
          {daysElapsed} of {daysIn} day{daysIn === 1 ? '' : 's'} elapsed
        </div>
      </div>

      {loadError ? (
        <div className="glass-section-card rounded-xl text-center py-12 px-6">
          <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-3 text-red-400" />
          <p className="text-sm text-[var(--foreground)] font-medium mb-1">
            Could not load monthly over/under.
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">{loadError}</p>
        </div>
      ) : data == null ? (
        <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
          Loading…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Per-ad spend block — denser 2-column grid so 10+ ads stay
              readable without a long scroll. Single-column on mobile. */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="px-3 py-2 bg-[var(--muted)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Spend by ad
            </div>
            {data.ads.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
                No ads in {fmtPeriodLong(period)}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-px gap-y-px bg-[var(--border)]">
                  {data.ads.map((ad) => (
                    <div
                      key={ad.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--card)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[var(--foreground)] truncate leading-tight">
                          {ad.name}
                        </div>
                        {ad.id !== 'aggregate' && (
                          <div className="text-[9px] leading-tight">
                            <span
                              className="font-semibold"
                              style={{ color: sourceColor(ad.budgetSource) }}
                            >
                              {sourceLabel(ad.budgetSource)}
                            </span>
                            <span className="text-[var(--muted-foreground)]">
                              {' · '}
                              {ad.allocation > 0 ? fmt(ad.allocation) : '—'}
                            </span>
                            {ad.lifetimeInProgress && (
                              <span
                                className="ml-1 font-semibold"
                                style={{ color: COLORS.lifetime }}
                                title="Lifetime ad still running — excluded from the over/under until its run completes (still counted in total spend)."
                              >
                                · lifetime · in progress
                              </span>
                            )}
                            {ad.fullRunAppliedToMonth && (
                              <span
                                className="ml-1 font-semibold"
                                style={{ color: '#38bdf8' }}
                                title="Full run counted in this month — the over/under compares the full run to the full target."
                              >
                                · full run → {fmtPeriodLong(ad.fullRunAppliedToMonth)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className="text-sm font-semibold text-[var(--foreground)] tabular-nums">
                          {fmt(ad.actual)}
                        </div>
                        {ad.id !== 'aggregate' &&
                          ad.variance &&
                          ad.variance.klass !== 'lifetime-in-progress' &&
                          Math.abs(ad.variance.contribution) >= 0.005 && (
                            <div
                              className="text-[9px] font-semibold tabular-nums leading-tight"
                              style={{ color: varianceColor(ad.variance.contribution) }}
                              title={
                                ad.variance.klass === 'billed-cross-month'
                                  ? "This ad's over/under on its FULL run vs target (billed in this month)."
                                  : "This ad's over/under vs its allocation."
                              }
                            >
                              {ad.variance.contribution >= 0 ? '+' : '−'}
                              {fmt(Math.abs(ad.variance.contribution))}
                            </div>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--muted)]/40 border-t-2 border-[var(--border)]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--foreground)]">
                    Total spent this month · {data.ads.length} ad{data.ads.length === 1 ? '' : 's'}
                  </div>
                  <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                    {fmt(totalInMonth)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Client budget / should-have-spent (left) and the variance vs
              should-have-spent (right). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Client Budget
                  </div>
                  <div className="text-base font-bold tabular-nums text-[var(--foreground)]">
                    {fmt(budgetGross)}
                  </div>
                  {accountKey && (
                    <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                      Base {fmt(data.baseBudgetGoal)} + Added{' '}
                      {fmt(data.addedBudgetGoal)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Should have spent
                  </div>
                  <div
                    className="text-base font-bold tabular-nums"
                    style={{ color: COLORS.daily }}
                  >
                    {fmt(shouldHaveSpent)}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                    {`${fmt(budgetGross)} × ${effectiveMarkup}`}
                    {ipLifeAlloc > 0
                      ? ` − ${fmt(ipLifeAlloc)} lifetime in progress`
                      : ''}
                  </div>
                </div>
              </div>
            </div>
            {/* Variance — tracked spend vs should-have-spent. Positive =
                overspent; negative = underspent. */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Variance vs Should Have Spent
              </div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: varianceColor(variance) }}
              >
                {`${variance >= 0 ? '+' : '-'}${fmt(Math.abs(variance))}`}
                <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                  {variance > 0.005
                    ? 'overspent'
                    : variance < -0.005
                      ? 'underspent'
                      : 'on target'}
                </span>
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                billed{' '}
                <span className="font-semibold text-[var(--foreground)]">
                  {fmt(overUnderActual)}
                </span>
                {' − '}
                <span className="font-semibold text-[var(--foreground)]">
                  {fmt(shouldHaveSpent)}
                </span>
                {' should have spent'}
              </div>
              {crossMonthCount > 0 && (
                <div
                  className="text-[10px] mt-1"
                  style={{ color: '#38bdf8' }}
                  title="These ads are billed in this month though they ran across months — the over/under counts their full run, so the month's total spend is lower by the part that spent in another month."
                >
                  {crossMonthCount} ad{crossMonthCount === 1 ? '' : 's'} billed cross-month ·{' '}
                  <span className="font-semibold text-[var(--foreground)]">
                    {fmt(billedElsewhere)}
                  </span>{' '}
                  of the billed spend landed in another month (total spent this month{' '}
                  {fmt(totalInMonth)})
                </div>
              )}
              {inProgressLifetime.length > 0 && (
                <div
                  className="text-[10px] mt-1"
                  style={{ color: COLORS.lifetime }}
                  title="A lifetime ad still running is excluded from the over/under — both its spend and its target — until its run completes, when its single variance books once. Its spend is still counted in the tracked total above."
                >
                  Excludes {inProgressLifetime.length} lifetime ad
                  {inProgressLifetime.length === 1 ? '' : 's'} in progress ·{' '}
                  {fmt(heldOutLifetime)} spent · settles on completion
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Overview ────────────────────────────────────────────────────────
interface OverviewAccount {
  accountKey: string;
  dealer: string;
  // §0.1: resolved per-account markup factor for the gross-up display.
  markup: number;
  baseBudgetGoal: string | null;
  addedBudgetGoal: string | null;
  // Server-side aggregated count of account-level pacer notes — drives
  // the chat badge on the overview row without an extra round-trip.
  notesCount: number;
  ads: PacerAd[];
}

function OverviewAccountRow({
  account,
  period,
  expanded,
  onToggle,
  onOpenAccount,
  filters,
  currentUserId,
  users,
}: {
  account: OverviewAccount;
  period: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenAccount: () => void;
  filters: PlanFilters;
  currentUserId: string | null;
  users: DirectoryUser[];
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number>(account.notesCount);
  useEffect(() => {
    setNotesCount(account.notesCount);
  }, [account.notesCount]);
  const visibleAds = useMemo(
    () => applyFilters(account.ads, filters, currentUserId),
    [account.ads, filters, currentUserId],
  );
  const filtersActive = activeFilterCount(filters) > 0;
  // When filters are active, the collapsed header reflects only the
  // matching subset so reps can scan which accounts have hits without
  // expanding each row. Default state (no filters) shows the full picture.
  const headerAds = filtersActive ? visibleAds : account.ads;
  const noMatches = filtersActive && visibleAds.length === 0;

  // Show the client's agreed budget goals (gross dollars) rather than the
  // running allocation total — easier for admins to see commitments at a
  // glance. The COMBINED Base+Added is the primary billing figure (Change 8);
  // Base/Added are shown as its components so the sum is visible at a glance.
  // Always the true client budget (gross) — never carryover/pacing-adjusted.
  const baseTotal = num(account.baseBudgetGoal) ?? 0;
  const addedTotal = num(account.addedBudgetGoal) ?? 0;
  const combinedTotal = baseTotal + addedTotal;

  return (
    <div
      className={`glass-section-card rounded-xl mb-2.5 overflow-hidden transition-opacity ${
        noMatches ? 'opacity-50' : ''
      }`}
    >
      {/* Header row — title + tag stay inline, status battery stacks below.
          Right cluster (Base/Added/Open) is vertically centered against the
          full card height. */}
      <div
        className="flex items-center justify-between gap-4 px-4 py-3.5 cursor-pointer"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap min-w-0 mb-2">
            {expanded ? (
              <ChevronDownIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            )}
            <span className="text-lg font-bold text-[var(--foreground)] truncate min-w-0 max-w-[320px] tracking-tight">
              {account.dealer}
            </span>
            <span className="text-[11px] text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded-full whitespace-nowrap">
              {filtersActive
                ? `${visibleAds.length} of ${account.ads.length} ad${account.ads.length !== 1 ? 's' : ''}`
                : `${account.ads.length} ad${account.ads.length !== 1 ? 's' : ''}`}
            </span>
          </div>
          {headerAds.length > 0 ? (
            <div className="pl-7 max-w-[440px]">
              <StatusBattery ads={headerAds} size="lg" />
            </div>
          ) : noMatches ? (
            <div className="pl-7 text-[11px] text-[var(--muted-foreground)] italic">
              No ads match the current filters.
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-5 flex-shrink-0">
          {combinedTotal > 0 && (
            <div
              className="text-right"
              title="Billing figure — combined Base + Added client budget (gross). Should match the planner for this account and month."
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Total Budget
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {fmt(combinedTotal)}
              </div>
              {/* Components — the two add up to the total, in view for an
                  at-a-glance reconciliation. */}
              <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[10px] tabular-nums">
                <span style={{ color: COLORS.base }}>Base {fmt(baseTotal)}</span>
                <span className="text-[var(--muted-foreground)]">·</span>
                <span style={{ color: COLORS.added }}>
                  Added {fmt(addedTotal)}
                </span>
              </div>
            </div>
          )}
          <div onClick={(e) => e.stopPropagation()}>
            <AccountNotesButton
              count={notesCount}
              onClick={() => setNotesOpen(true)}
              ariaLabel={`Open notes for ${account.dealer}`}
            />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAccount();
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            title="Open account"
          >
            Open
          </button>
        </div>
      </div>

      {/* Drill-down: compact ad rows */}
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
          {account.ads.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] py-3 text-center">
              No ads in this period.
            </div>
          ) : visibleAds.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] py-3 text-center">
              No ads match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {[
                      'Ad',
                      'Status',
                      'Source',
                      'Type',
                      'Client Budget',
                      'Allocation',
                      'Flight',
                      'Action',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleAds.map((ad, i) => (
                    <tr key={ad.id} className="border-b border-[var(--border)]">
                      <td className="px-2 py-2 text-[var(--foreground)] max-w-[200px] truncate">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle"
                          style={{ background: AD_COLORS[i % AD_COLORS.length] }}
                        />
                        {ad.name}
                      </td>
                      <td className="px-2 py-2">
                        <AdStatusPill status={ad.adStatus} />
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            background: sourceTint(ad.budgetSource),
                            color: sourceColor(ad.budgetSource),
                          }}
                        >
                          {sourceLabel(ad.budgetSource)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">
                        {ad.budgetType}
                      </td>
                      <td
                        className="px-2 py-2 font-semibold whitespace-nowrap"
                        style={{ color: COLORS.daily }}
                        title="Gross client-facing dollars (allocation grossed up by markup)"
                      >
                        {(() => {
                          const m = effMarkupOf(account.markup);
                          return num(ad.allocation) != null && m > 0
                            ? fmt(Math.round((num(ad.allocation)! / m) * 100) / 100)
                            : '—';
                        })()}
                      </td>
                      <td className="px-2 py-2 text-[var(--foreground)]">
                        {num(ad.allocation) != null ? fmt(num(ad.allocation)!) : '—'}
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)] whitespace-nowrap">
                        {ad.flightStart && ad.flightEnd
                          ? `${fmtDate(ad.flightStart)} – ${fmtDate(ad.flightEnd)}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">
                        {ad.actionNeeded || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {notesOpen && (
        <AccountNotesDrawer
          accountKey={account.accountKey}
          accountLabel={account.dealer}
          period={period}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setNotesOpen(false)}
          onCountChange={setNotesCount}
        />
      )}
    </div>
  );
}

function OverviewView({
  period,
  filters,
  currentUserId,
  onOpenAccount,
  users,
  accounts,
  loadError,
}: {
  period: string;
  filters: PlanFilters;
  currentUserId: string | null;
  onOpenAccount: (accountKey: string) => void;
  users: DirectoryUser[];
  // List + error are owned by the parent so the filter sidebar can
  // share the same ads — see MetaAdsPlannerTool for the fetch.
  accounts: OverviewAccount[] | null;
  loadError: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loadError) {
    return (
      <div className="glass-section-card rounded-xl text-center py-16 px-6">
        <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-3 text-red-400" />
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">
          Could not load overview.
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">{loadError}</p>
      </div>
    );
  }

  if (accounts == null) {
    return (
      <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
        Loading accounts…
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="glass-section-card rounded-xl text-center py-16 px-6">
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">
          No accounts available.
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          You don&apos;t have access to any accounts.
        </p>
      </div>
    );
  }

  // Sort: accounts with ads first, then by dealer name (already alphabetical)
  const sorted = [...accounts].sort((a, b) => {
    if (a.ads.length === 0 && b.ads.length > 0) return 1;
    if (a.ads.length > 0 && b.ads.length === 0) return -1;
    return 0;
  });

  return (
    <div className="space-y-2.5">
      <SectionLabel
        icon={<ClipboardDocumentListIcon className="w-3 h-3" />}
        text={`All Accounts · ${fmtPeriodLong(period)}`}
      />
      {sorted.map((acct) => (
        <OverviewAccountRow
          key={acct.accountKey}
          account={acct}
          period={period}
          expanded={expanded.has(acct.accountKey)}
          onToggle={() => toggleExpand(acct.accountKey)}
          onOpenAccount={() => onOpenAccount(acct.accountKey)}
          filters={filters}
          currentUserId={currentUserId}
          users={users}
        />
      ))}
    </div>
  );
}

// ─── Main tool component ───────────────────────────────────────────────────
/**
 * Shared shell rendered by both the Ad Planner and Ad Pacer pages. The
 * `mode` prop controls which surface is shown. In `pacer` mode the page
 * header gets a Pacer | Summary toggle that swaps the body content.
 */
type MetaToolMode = 'planner' | 'pacer';
type PacerInnerTab = 'pacer' | 'summary' | 'compare';
// Planner page sub-tabs: the planner itself + the Reconciliation view
// (moved here from the Pacer page).
type PlannerInnerTab = 'planner' | 'reconcile';

export function MetaAdsPlannerTool({ mode }: { mode: MetaToolMode }) {
  const { accountKey, accounts, setAccount } = useAccount();
  const { data: session } = useSession();
  const { markDirty, markClean } = useUnsavedChanges();
  const currentUserId = session?.user?.id ?? null;

  const activeKey = accountKey;
  const activeAccount = activeKey ? accounts[activeKey] : null;

  // ── URL state: period (and pacerTab on the Ad Pacer page) sync to/from
  //    query params so reload and bookmarks survive. Filters and view-mode
  //    stay in local state.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPeriod = searchParams.get('period');
  const urlPacerTab = searchParams.get('pacerTab');
  const urlPlannerTab = searchParams.get('plannerTab');

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [period, setPeriod] = useState<string>(
    urlPeriod && isValidPeriod(urlPeriod) ? urlPeriod : currentPeriod(),
  );
  const [periodSummaries, setPeriodSummaries] = useState<PeriodSummary[]>([]);
  const [plan, setPlan] = useState<PacerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Autosave still tracks status via setSaveStatus; the visible indicator was
  // removed from the header, so the value itself is no longer read.
  const [, setSaveStatus] = useState<SaveStatus>('idle');
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [applyingCarryover, setApplyingCarryover] = useState(false);
  const [carryoverBucket, setCarryoverBucket] = useState<'base' | 'added'>('base');
  const [carryoverDismissed, setCarryoverDismissed] = useState(false);
  // Budget Log + Change Log now live in the account scope row (pacer), so
  // their open-state + drawers are lifted here and work on every pacer sub-tab.
  const [budgetLogOpen, setBudgetLogOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const adsSnapshot = useMemo<AdSnapshot[]>(
    () =>
      plan
        ? plan.ads.map((ad) => {
            const c = buildAdCalc(ad, Date.now(), plan.timeZone);
            return {
              adId: ad.id,
              adName: ad.name || 'Untitled Ad',
              budgetType: ad.budgetType,
              budgetSource: ad.budgetSource,
              budget: c.totalBudget,
              projected: c.projected,
              actual: c.actual,
              target: c.target,
              recDaily: c.recDaily,
            };
          })
        : [],
    [plan],
  );
  const [pacerTab, setPacerTab] = useState<PacerInnerTab>(
    urlPacerTab === 'summary'
      ? 'summary'
      : urlPacerTab === 'compare'
        ? 'compare'
        : 'pacer',
  );
  const [plannerTab, setPlannerTab] = useState<PlannerInnerTab>(
    urlPlannerTab === 'reconcile' ? 'reconcile' : 'planner',
  );

  // Mirror state changes back into the URL (replace, not push, so the
  // back button stays useful for actual navigation).
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('period', period);
    if (mode === 'pacer') next.set('pacerTab', pacerTab);
    else next.delete('pacerTab');
    if (mode === 'planner') next.set('plannerTab', plannerTab);
    else next.delete('plannerTab');
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
    // Intentionally exclude `searchParams` so external param changes don't
    // re-trigger this loop (we read from it once on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, pacerTab, plannerTab, mode, pathname, router]);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  // Lifted overview list — fetched once per period when there's no
  // active account so the parent can also wire the filter sidebar's
  // `ads` prop on the admin overview. OverviewView consumes this via
  // props instead of owning the fetch.
  const [overviewAccounts, setOverviewAccounts] = useState<OverviewAccount[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  useEffect(() => {
    if (activeKey) return; // only relevant for the admin overview
    let cancelled = false;
    setOverviewAccounts(null);
    setOverviewError(null);
    fetch(`/api/meta-ads-pacer/overview?period=${period}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<{ accounts: OverviewAccount[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setOverviewAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] overview load failed', err);
        setOverviewError(err instanceof Error ? err.message : 'Failed to load overview');
      });
    return () => {
      cancelled = true;
    };
  }, [period, activeKey]);
  // Flatten every overview account's ads so the filter sidebar can
  // surface accurate Quick View counts + account-rep options on the
  // admin overview (when there's no per-account `plan` to draw from).
  const overviewAds = useMemo(
    () => (overviewAccounts ?? []).flatMap((a) => a.ads),
    [overviewAccounts],
  );
  // True while the AdEditorModal is open. Pauses autosave so transient draft
  // edits don't get persisted until the user clicks Save.
  const [editorOpen, setEditorOpen] = useState(false);
  // Account-level notes modal — opened from the chat icon next to the
  // period selector. Count fetched on activeKey change so the badge can
  // surface "this account has notes" without opening the panel.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  useEffect(() => {
    if (!accountKey) {
      setNotesCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/notes?period=${period}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((data: { notes?: AccountNote[] }) => {
        if (cancelled) return;
        setNotesCount(Array.isArray(data.notes) ? data.notes.length : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setNotesCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  // ── Fetch directory of users (once) ──
  useEffect(() => {
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
      })
      .catch(() => {
        // tolerate failure — pickers will just show empty list
      });
  }, []);

  // ── Load plan whenever active account or period changes ──
  useEffect(() => {
    if (!activeKey) {
      setPlan(null);
      setLoadError(null);
      setLoaded(true);
      setPeriodSummaries([]);
      setFilters(EMPTY_FILTERS);
      return;
    }
    setLoaded(false);
    setLoadError(null);
    setFilters(EMPTY_FILTERS);
    setCarryoverDismissed(false);
    setCarryoverBucket('base');

    Promise.all([
      fetch(`/api/meta-ads-pacer/${activeKey}?period=${period}`).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<PacerPlan>;
      }),
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .catch(() => ({ periods: [] })) as Promise<{ periods: PeriodSummary[] }>,
    ])
      .then(([planData, periodsData]) => {
        setPlan({
          accountKey: planData.accountKey ?? activeKey,
          period: planData.period ?? period,
          baseBudgetGoal: planData.baseBudgetGoal ?? null,
          addedBudgetGoal: planData.addedBudgetGoal ?? null,
          markup:
            typeof planData.markup === 'number' &&
            Number.isFinite(planData.markup)
              ? planData.markup
              : null,
          timeZone:
            typeof planData.timeZone === 'string' && planData.timeZone
              ? planData.timeZone
              : DEFAULT_TIME_ZONE,
          frozen: planData.frozen === true,
          frozenAt: planData.frozenAt ?? null,
          reopened: planData.reopened === true,
          baseCarryover: planData.baseCarryover ?? null,
          addedCarryover: planData.addedCarryover ?? null,
          priorOverUnder: planData.priorOverUnder ?? null,
          ads: Array.isArray(planData.ads) ? planData.ads : [],
        });
        setPeriodSummaries(
          Array.isArray(periodsData?.periods) ? periodsData.periods : [],
        );
        setLoaded(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] failed to load plan', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load plan');
        setLoaded(true);
      });
  }, [activeKey, period]);

  // ── Debounced save (PUT) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  // Reset save dedupe when account/period changes so the first edit triggers a save
  useEffect(() => {
    lastSavedRef.current = '';
  }, [activeKey, period]);

  useEffect(() => {
    if (!loaded || !activeKey || !plan) return;
    // A frozen (closed) month is read-only — never autosave it. The server
    // also rejects the write, but suppressing here avoids failed-save churn.
    if (plan.frozen) return;
    // Pause autosave while the editor modal is open so partial drafts aren't
    // persisted; the modal commits via its own Save handler instead.
    if (editorOpen) return;
    const serialized = JSON.stringify({
      baseBudgetGoal: plan.baseBudgetGoal,
      addedBudgetGoal: plan.addedBudgetGoal,
      ads: plan.ads.map((a, i) => ({ ...a, position: i, period })),
    });
    if (serialized === lastSavedRef.current) return;

    // Local plan diverged from the last-saved baseline — flag the global
    // unsaved-changes guard so navigating away mid-edit prompts the user.
    markDirty();
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // Retries the PUT once with backoff before surfacing an error so
      // a transient blip (network hiccup, cold lambda) doesn't strand the
      // user with a red dot. Both attempts use the same serialized body —
      // saves are idempotent at this granularity.
      const attemptSave = async (attempt = 0): Promise<boolean> => {
        try {
          const res = await fetch(
            `/api/meta-ads-pacer/${activeKey}?period=${period}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: serialized,
            },
          );
          if (!res.ok) throw new Error('save failed');
          // Don't replace local state with the server response — the user may
          // have typed more during the 600ms debounce + network round-trip,
          // and overwriting would clobber those keystrokes.
          await res.json().catch(() => null);
          return true;
        } catch {
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return attemptSave(attempt + 1);
          }
          return false;
        }
      };
      const ok = await attemptSave();
      if (ok) {
        lastSavedRef.current = serialized;
        setSaveStatus('saved');
        markClean();
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else {
        setSaveStatus('error');
      }
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [plan, activeKey, loaded, period, markClean, markDirty, editorOpen]);

  // ── Sync actual spend from Facebook ──
  // Pulls per-campaign spend for the current period and drops the refreshed
  // plan straight into state. Linked rows (or rows whose name matches a
  // campaign) get their pacerActual overwritten by Facebook's number; the
  // existing autosave effect persists the result.
  const handleSyncMeta = async () => {
    if (!activeKey || syncingMeta) return;
    setSyncingMeta(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/sync-meta?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Meta sync failed.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
      });
      const sync = data.sync as
        | { matched: number; total: number; results: { matched: boolean; name: string }[] }
        | undefined;
      if (!sync || sync.total === 0) {
        toast.success('Synced — no ads to match for this period yet.');
      } else if (sync.matched === 0) {
        toast.error(
          'No ads matched a Meta campaign. Name a pacer ad exactly like its campaign, then sync again.',
        );
      } else {
        const unmatched = sync.results
          .filter((r) => !r.matched)
          .map((r) => r.name || 'Untitled');
        toast.success(
          `Synced spend for ${sync.matched} of ${sync.total} ad${
            sync.total === 1 ? '' : 's'
          } from Meta.${
            unmatched.length ? ` Unmatched: ${unmatched.join(', ')}.` : ''
          }`,
        );
      }
    } catch {
      toast.error('Meta sync failed.');
    } finally {
      setSyncingMeta(false);
    }
  };

  // ── Reopen a frozen (closed) month for correction (admin escape hatch) ──
  const handleReopenMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/reopen?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not reopen this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
      });
      // Re-enable autosave from the reopened baseline.
      lastSavedRef.current = '';
      toast.success(
        `${fmtPeriodLong(period)} reopened for editing. The original snapshot is kept; it re-freezes on the next close.`,
      );
    } catch {
      toast.error('Could not reopen this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Re-freeze a reopened month once corrections are done ──
  const handleRefreezeMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/freeze?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not re-freeze this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
      });
      toast.success(`${fmtPeriodLong(period)} re-frozen.`);
    } catch {
      toast.error('Could not re-freeze this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Apply / clear last month's carryover into this month (Change 7) ──
  const handleApplyCarryover = async (
    bucket: 'base' | 'added',
    clear: boolean,
  ) => {
    if (!activeKey || applyingCarryover) return;
    setApplyingCarryover(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/carryover?period=${period}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, clear }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not update carryover.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
      });
      toast.success(
        clear
          ? 'Carryover removed.'
          : `Carried last month's over/under into ${bucket === 'base' ? 'Base' : 'Added'}.`,
      );
    } catch {
      toast.error('Could not update carryover.');
    } finally {
      setApplyingCarryover(false);
    }
  };

  // ── Copy from another period ──
  const handleCopyFrom = async (
    fromPeriod: string,
    adIds: string[] | undefined,
    fields: CopyFieldOptions,
  ) => {
    if (!activeKey || !fromPeriod || fromPeriod === period) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/meta-ads-pacer/${activeKey}/copy-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromPeriod,
          to: period,
          fields,
          ...(adIds && adIds.length > 0 ? { adIds } : {}),
        }),
      });
      if (!res.ok) throw new Error('copy failed');
      const updated = (await res.json()) as PacerPlan;
      setPlan({
        accountKey: updated.accountKey ?? activeKey,
        period: updated.period ?? period,
        baseBudgetGoal: updated.baseBudgetGoal ?? null,
        addedBudgetGoal: updated.addedBudgetGoal ?? null,
        markup:
          typeof updated.markup === 'number' && Number.isFinite(updated.markup)
            ? updated.markup
            : null,
        timeZone:
          typeof updated.timeZone === 'string' && updated.timeZone
            ? updated.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: updated.frozen === true,
        frozenAt: updated.frozenAt ?? null,
        reopened: updated.reopened === true,
        baseCarryover: updated.baseCarryover ?? null,
        addedCarryover: updated.addedCarryover ?? null,
        priorOverUnder: updated.priorOverUnder ?? null,
        ads: Array.isArray(updated.ads) ? updated.ads : [],
      });
      lastSavedRef.current = JSON.stringify({
        baseBudgetGoal: updated.baseBudgetGoal,
        addedBudgetGoal: updated.addedBudgetGoal,
        ads: (updated.ads ?? []).map((a, i) => ({ ...a, position: i, period })),
      });
      // Refresh periods list (target now has ads)
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .then((data: { periods: PeriodSummary[] }) =>
          setPeriodSummaries(Array.isArray(data?.periods) ? data.periods : []),
        )
        .catch(() => {});
      setSaveStatus('saved');
      markClean();
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Activity log handlers (per-event endpoints) ──
  const onAddActivity = async (adId: string, text: string, file: File | null) => {
    if (!activeKey) return;
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', file);
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        body: fd,
      });
    } else {
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId ? { ...a, activityLog: [...a.activityLog, entry] } : a,
            ),
          }
        : p,
    );
  };

  const onEditActivity = async (adId: string, entryId: string, text: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? {
                    ...a,
                    activityLog: a.activityLog.map((x) =>
                      x.id === entryId ? entry : x,
                    ),
                  }
                : a,
            ),
          }
        : p,
    );
  };

  const onDeleteActivity = async (adId: string, entryId: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? { ...a, activityLog: a.activityLog.filter((x) => x.id !== entryId) }
                : a,
            ),
          }
        : p,
    );
  };

  // ── Header totals ──
  const totals = useMemo(() => {
    if (!plan) return { base: 0, added: 0, actual: 0 };
    let base = 0;
    let added = 0;
    let actual = 0;
    plan.ads.forEach((ad) => {
      const c = adContribution(ad);
      base += c.baseAllocation;
      added += c.addedAllocation;
      // §2: a resolved straddler counts its full run in its own month.
      actual += effectiveActual(ad);
    });
    return { base, added, actual };
  }, [plan]);


  return (
    <PacerReadOnlyContext.Provider value={!!plan?.frozen}>
    <div className="animate-fade-in-up">
      {/* Page header */}
      <div
        className={`page-sticky-header pad-on-scroll flex items-center justify-between gap-4 flex-wrap ${
          mode === 'pacer' ? 'mb-6' : 'mb-10'
        }`}
      >
        <div className="flex items-center gap-3">
          <MetaBrandIcon className="w-8 h-8" />
          <div>
            <h2 className="text-2xl font-bold">
              {mode === 'planner' ? 'Meta Ad Planner' : 'Meta Ad Pacer'}
            </h2>
            <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
              {mode === 'planner'
                ? 'Plan and allocate your monthly Meta ad budgets'
                : 'Track spend pacing across the active period'}
            </p>
          </div>
        </div>

        {/* Month + general filters live up here in the title row (replacing
            the old auto-save indicator). */}
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodSelector period={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={() => setFilterSidebarOpen((o) => !o)}
            aria-pressed={filterSidebarOpen}
            aria-expanded={filterSidebarOpen}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              filterSidebarOpen
                ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary)]'
                : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            <FunnelIcon className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount(filters) > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold"
                style={{ background: 'var(--primary)', color: 'white' }}
              >
                {activeFilterCount(filters)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Pacer sub-tabs — their own full-width row, sitting between the page
          title above and the account name + actions row below. */}
      {mode === 'pacer' && (
        <div className="mb-8 flex items-center gap-1 border-b border-[var(--border)]">
          {activeKey && (
            <>
              <button
                type="button"
                onClick={() => setPacerTab('summary')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'summary'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <TableCellsIcon className="w-3.5 h-3.5" />
                Summary
              </button>
              <button
                type="button"
                onClick={() => setPacerTab('pacer')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'pacer'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                Pacer
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setPacerTab('compare')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              pacerTab === 'compare'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ScaleIcon className="w-3.5 h-3.5" />
            Over/Under Spend
          </button>
        </div>
      )}

      {/* Planner sub-tabs — Planner + Reconciliation, mirroring the Pacer
          page's tab row. Only shown when an account is selected, since the
          Reconciliation view needs an account. */}
      {mode === 'planner' && activeKey && (
        <div className="mb-8 flex items-center gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => setPlannerTab('planner')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'planner'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
            Planner
          </button>
          <button
            type="button"
            onClick={() => setPlannerTab('reconcile')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'reconcile'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <InvestmentIcon className="w-3.5 h-3.5" />
            Reconciliation
          </button>
        </div>
      )}

      {/* Scope row — avatar + account name + status battery on the left;
          period + filters on the right */}
      <div className="mb-10 flex items-start justify-between gap-4 flex-wrap">
        {activeKey ? (
          <div className="flex items-center gap-3 min-w-0">
            <AccountAvatar
              name={activeAccount?.dealer ?? activeKey}
              accountKey={activeKey}
              storefrontImage={activeAccount?.storefrontImage}
              logos={activeAccount?.logos}
              size={56}
              className="rounded-xl border border-[var(--border)] bg-[var(--muted)] flex-shrink-0"
            />
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-2xl font-bold text-[var(--foreground)] leading-tight">
                {activeAccount?.dealer || activeKey || '—'}
              </span>
              {plan && plan.ads.length > 0 && <StatusBattery ads={plan.ads} />}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-sm text-[var(--muted-foreground)]">
              All accounts overview
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {activeKey && (
            <AccountNotesButton
              count={notesCount}
              onClick={() => setNotesOpen(true)}
              ariaLabel={`Open notes for ${activeAccount?.dealer ?? activeKey}`}
            />
          )}
          {/* Pacer: Change log + Budget log as bare icons (names in tooltips),
              sized to match the chat icon. */}
          {activeKey && mode === 'pacer' && (
            <>
              <Tooltip label="Change log" placement="bottom">
                <button
                  type="button"
                  onClick={() => setChangeLogOpen(true)}
                  aria-label="Change log"
                  className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  <ClockIcon className="w-6 h-6" />
                </button>
              </Tooltip>
              <Tooltip label="Budget Log" placement="bottom">
                <button
                  type="button"
                  onClick={() => setBudgetLogOpen(true)}
                  aria-label="Budget Log"
                  className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  <ClipboardDocumentListIcon className="w-6 h-6" />
                </button>
              </Tooltip>
            </>
          )}
          {/* Sync from Meta sits to the right of the icons. Pacer only — the
              planner is for planning, so it doesn't pull actual spend. */}
          {activeKey && mode === 'pacer' && (
            <button
              type="button"
              onClick={handleSyncMeta}
              disabled={syncingMeta || !!plan?.frozen}
              title={
                plan?.frozen
                  ? 'This month is frozen — reopen it to re-sync'
                  : "Pull actual spend from Meta for this period's linked campaigns"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncingMeta ? (
                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MetaBrandIcon className="w-3.5 h-3.5" />
              )}
              {syncingMeta ? 'Syncing…' : 'Sync from Meta'}
            </button>
          )}
        </div>
      </div>

      {/* Frozen-month banner (Change 5). A closed month is a read-only,
          immutable snapshot of what was actually managed; admins can reopen
          it to correct, which keeps the original snapshot as the record. */}
      {activeKey && plan?.frozen && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3"
          style={{ borderColor: COLORS.warn, background: 'rgba(245,158,11,0.08)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <LockClosedIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} is frozen — closed month
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Read-only snapshot of what was managed
                {plan.frozenAt ? ` · frozen ${fmtSyncedAgo(plan.frozenAt)}` : ''}.
                Editing and Meta sync are disabled.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReopenMonth}
            disabled={reopening}
            title="Reopen this month for corrections (admin). The original snapshot is kept."
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon
              className={`w-3.5 h-3.5 ${reopening ? 'animate-spin' : ''}`}
            />
            {reopening ? 'Reopening…' : 'Reopen month'}
          </button>
        </div>
      )}

      {/* Reopened closed month — editable for correction; prompt to re-freeze
          when done so it relocks as a faithful record. */}
      {activeKey && plan?.reopened && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <ExclamationTriangleIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} reopened — closed month, editing enabled
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Changes save normally. Re-freeze when finished to lock it back as
                the record of what happened.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefreezeMonth}
            disabled={reopening}
            title="Re-freeze this month, locking it read-only again"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LockClosedIcon className="w-3.5 h-3.5" />
            {reopening ? 'Working…' : 'Re-freeze month'}
          </button>
        </div>
      )}

      {/* Body — budget header + content + inline filter sidebar all share
          the same 2-col grid so the header rows shrink alongside the body
          when the filter panel opens. Layout applies on both the
          per-account view and the admin overview. */}
      <div
        className={
          filterSidebarOpen
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start'
            : ''
        }
      >
        <div className="min-w-0">
          {/* Budget header (Total + Base/Added) — only on the Planner tab */}
          {activeKey && plan && mode === 'planner' && plannerTab === 'planner' && (
            <div className="mb-10 space-y-5">
              {/* Carryover prompt (Change 7) — fold last month's settled
                  over/under into this month's spend target, opt-in, per
                  bucket. Never touches the client budget goal. */}
              {!plan.frozen &&
                (() => {
                  const prior = plan.priorOverUnder;
                  const appliedBase = num(plan.baseCarryover);
                  const appliedAdded = num(plan.addedCarryover);
                  const applied = appliedBase != null || appliedAdded != null;
                  // Always surface an unapplied prior over/under so you can
                  // decide whether to fold it in — even below the threshold.
                  // Only hide when there's nothing meaningful to show.
                  if (!applied && (!prior || Math.abs(prior.variance) < 0.005)) {
                    return null;
                  }
                  const fromLabel = fmtPeriodShort(shiftPeriod(period, -1));
                  if (applied) {
                    const amt = appliedBase != null ? appliedBase : appliedAdded ?? 0;
                    const bucket = appliedBase != null ? 'base' : 'added';
                    return (
                      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ArrowPathIcon className="w-4 h-4 flex-shrink-0 text-[var(--primary)]" />
                          <span className="text-xs text-[var(--foreground)]">
                            Carryover applied:{' '}
                            <span className="font-semibold">
                              {amt >= 0 ? '+' : '−'}
                              {fmt(Math.abs(amt))}
                            </span>{' '}
                            to {bucket === 'base' ? 'Base' : 'Added'} (from{' '}
                            {fromLabel}). The client budget is unchanged.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleApplyCarryover(bucket, true)}
                          disabled={applyingCarryover}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  }
                  // Not applied — surface the prior month's over/under.
                  const variance = prior!.variance;
                  const under = variance < 0;
                  const carry = prior!.carryover;
                  // Prominent (loud amber) only when it crosses the threshold and
                  // hasn't been dismissed; otherwise a quiet, always-visible line.
                  const prominent = prior!.exceedsThreshold && !carryoverDismissed;
                  if (!prominent) {
                    return (
                      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0 text-xs text-[var(--muted-foreground)]">
                          <ScaleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {fromLabel}
                            </span>{' '}
                            {under ? 'underspent' : 'overspent'} by{' '}
                            <span className="font-semibold text-[var(--foreground)]">
                              {fmt(Math.abs(variance))}
                            </span>{' '}
                            vs target.
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <select
                            value={carryoverBucket}
                            onChange={(e) =>
                              setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                            }
                            className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                            aria-label="Carryover bucket"
                          >
                            <option value="base">Base</option>
                            <option value="added">Added</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleApplyCarryover(carryoverBucket, false)}
                            disabled={applyingCarryover}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {applyingCarryover
                              ? 'Applying…'
                              : `Apply ${carry >= 0 ? '+' : '−'}${fmt(Math.abs(carry))}`}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      className="flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3"
                      style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.06)' }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ScaleIcon className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.warn }} />
                        <div className="min-w-0 text-xs text-[var(--foreground)]">
                          <span className="font-semibold">{fromLabel}</span>{' '}
                          {under ? 'underspent' : 'overspent'} by{' '}
                          <span className="font-semibold" style={{ color: under ? COLORS.warn : COLORS.error }}>
                            {fmt(Math.abs(variance))}
                          </span>{' '}
                          vs target — exceeds the {fmt(CARRYOVER_THRESHOLD)} threshold.
                          <span className="text-[var(--muted-foreground)]">
                            {' '}Apply{' '}
                            <span className="font-semibold text-[var(--foreground)]">
                              {carry >= 0 ? '+' : '−'}
                              {fmt(Math.abs(carry))}
                            </span>{' '}
                            to this month&apos;s spend target?
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={carryoverBucket}
                          onChange={(e) =>
                            setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                          }
                          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                          aria-label="Carryover bucket"
                        >
                          <option value="base">Base</option>
                          <option value="added">Added</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleApplyCarryover(carryoverBucket, false)}
                          disabled={applyingCarryover}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {applyingCarryover ? 'Applying…' : 'Apply'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCarryoverDismissed(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                        >
                          Leave as-is
                        </button>
                      </div>
                    </div>
                  );
                })()}
              <TotalAllocationHeader plan={plan} />
              <div className="flex gap-5 flex-wrap">
                <BudgetPanel
                  title="Base Budget"
                  source="base"
                  color={COLORS.base}
                  goalKey="baseBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
                <BudgetPanel
                  title="Added Budget"
                  source="added"
                  color={COLORS.added}
                  goalKey="addedBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
              </div>
            </div>
          )}

          {!activeKey ? (
            mode === 'pacer' && pacerTab === 'compare' ? (
              <div className="glass-section-card rounded-xl px-7 py-7">
                <ComparePanel accountKey={null} />
              </div>
            ) : (
              <OverviewView
                period={period}
                filters={filters}
                currentUserId={currentUserId}
                onOpenAccount={(key) =>
                  setAccount({ mode: 'account', accountKey: key })
                }
                users={users}
                accounts={overviewAccounts}
                loadError={overviewError}
              />
            )
          ) : !loaded ? (
            <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
              Loading saved data…
            </div>
          ) : loadError ? (
            <div className="glass-section-card rounded-xl text-center py-16 px-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-[var(--foreground)] text-sm font-medium mb-1">
                Could not load this account&apos;s planner data.
              </p>
              <p className="text-[var(--muted-foreground)] text-xs mb-1">{loadError}</p>
              <p className="text-[var(--muted-foreground)] text-xs">
                If you just deployed the new schema, restart the dev server so the Prisma
                client picks up the new models, then refresh.
              </p>
            </div>
          ) : !plan ? null : (() => {
            // Ad Planner + Pacer's Summary tab render flush (no outer card)
            // so the inner table reads as the page-level content. Pacer's
            // Pacer + Over/Under Spend tabs keep the glass-section-card
            // chrome since their content benefits from the visual frame.
            const flat =
              (mode === 'planner' && plannerTab === 'planner') ||
              (mode === 'pacer' && pacerTab === 'summary');
            const wrapperClass = flat
              ? ''
              : 'glass-section-card rounded-xl px-7 py-7';
            const inner =
              mode === 'planner' ? (
                plannerTab === 'reconcile' ? (
                  <ReconciliationPanel accountKey={activeKey} />
                ) : (
                  <AdPlannerPanel
                    plan={plan}
                    period={period}
                    users={users}
                    filters={filters}
                    onFiltersChange={setFilters}
                    currentUserId={currentUserId}
                    periodSummaries={periodSummaries}
                    onChange={setPlan}
                    onCopyFrom={handleCopyFrom}
                    onModalOpenChange={setEditorOpen}
                    onAddActivity={onAddActivity}
                    onEditActivity={onEditActivity}
                    onDeleteActivity={onDeleteActivity}
                  />
                )
              ) : pacerTab === 'pacer' ? (
                <BudgetPacerPanel
                  plan={plan}
                  filters={filters}
                  onFiltersChange={setFilters}
                  currentUserId={currentUserId}
                  onChange={setPlan}
                  totals={totals}
                  accountKey={activeKey}
                />
              ) : pacerTab === 'compare' ? (
                <ComparePanel accountKey={activeKey} />
              ) : (
                <SummaryPanel plan={plan} />
              );
            return flat ? inner : <div className={wrapperClass}>{inner}</div>;
          })()}
        </div>

        {/* Inline filter sidebar — renders on both per-account view
            (ads pulled from `plan.ads`) and the admin overview (ads
            flattened from `overviewAccounts`). The slide-in/out
            animation comes from the className transitions. */}
        <MetaAdsPacerFilterSidebar
          open={filterSidebarOpen}
          inline
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          onChange={setFilters}
          users={users}
          ads={activeKey ? plan?.ads ?? [] : overviewAds}
          currentUserId={currentUserId}
          className={`glass-panel glass-panel-strong w-full transition-[opacity,transform,max-height] duration-300 ease-out lg:sticky lg:top-24 lg:w-[360px] ${
            filterSidebarOpen
              ? 'pointer-events-auto max-h-[calc(100vh-8rem)] translate-x-0 opacity-100 animate-slide-in-right'
              : 'pointer-events-none max-h-0 translate-x-4 opacity-0 hidden'
          }`}
        />
      </div>

      {/* Account-level notes modal — opened from the chat icon next to
          the period selector (subaccount view) or the chat icon on
          each account row (admin overview). */}
      {notesOpen && activeKey && (
        <AccountNotesDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setNotesOpen(false)}
          onCountChange={setNotesCount}
        />
      )}
      {/* Budget Log + Change Log drawers — lifted here so the scope-row icon
          buttons work across every pacer sub-tab. */}
      {budgetLogOpen && activeKey && plan && (
        <BudgetLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          adsSnapshot={adsSnapshot}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setBudgetLogOpen(false)}
        />
      )}
      {changeLogOpen && activeKey && (
        <ChangeLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          onClose={() => setChangeLogOpen(false)}
        />
      )}
    </div>
    </PacerReadOnlyContext.Provider>
  );
}

// (Page-level entrypoints live at /tools/meta/ad-planner and /tools/meta/ad-pacer
// and import this component as `MetaAdsPlannerTool` with the appropriate `mode`.)
