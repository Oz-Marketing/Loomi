/**
 * Automatic audit log for the Meta Ads Pacer (Change 10). The save route, the
 * carryover/freeze/reopen endpoints, and the Meta sync all funnel changes
 * through `writeAudit` so the history is captured with no button press.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/** How long audit entries are retained before the daily purge drops them. */
export const AUDIT_RETENTION_DAYS = 365;

/**
 * Ad fields whose changes are logged (team decision: billing + pacing +
 * lifecycle + status & flight dates). Order drives display order.
 */
export const TRACKED_AD_FIELDS: Record<string, string> = {
  pacerDailyBudget: 'Daily budget',
  pacerActual: 'Actual spend',
  allocation: 'Allocation',
  budgetType: 'Budget type',
  budgetSource: 'Budget source',
  splitBaseAmount: 'Split base amount',
  adStatus: 'Status',
  flightStart: 'Flight start',
  flightEnd: 'Flight end',
  liveDate: 'Live date',
};

export interface AdFieldDiff {
  field: string;
  from: string | null;
  to: string | null;
}

/** Normalize a stored value for comparison/display ('' and null both → null). */
function norm(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length === 0 ? null : s;
}

/** Diff the tracked fields between an ad's before/after states. */
export function diffTrackedAdFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AdFieldDiff[] {
  const diffs: AdFieldDiff[] = [];
  for (const field of Object.keys(TRACKED_AD_FIELDS)) {
    const from = norm(before[field]);
    const to = norm(after[field]);
    if (from !== to) diffs.push({ field, from, to });
  }
  return diffs;
}

export interface AuditInput {
  accountKey: string;
  planId: string;
  period: string;
  /** Platform the change belongs to: 'google' for Google, null/'meta' for Meta. */
  platform?: string | null;
  adId?: string | null;
  adName?: string | null;
  action: string;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  summary: string;
  groupId?: string | null;
  authorUserId?: string | null;
}

/** A fresh group id to tie a multi-entry action (one save / bulk apply) together. */
export function newAuditGroupId(): string {
  return randomUUID();
}

/** Persist audit entries. Best-effort: never let logging break the write path. */
export async function writeAudit(entries: AuditInput[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await prisma.metaAdsPacerAuditEntry.createMany({
      data: entries.map((e) => ({
        accountKey: e.accountKey,
        planId: e.planId,
        period: e.period,
        platform: e.platform ?? null,
        adId: e.adId ?? null,
        adName: e.adName ?? null,
        action: e.action,
        field: e.field ?? null,
        fromValue: e.fromValue ?? null,
        toValue: e.toValue ?? null,
        summary: e.summary,
        groupId: e.groupId ?? null,
        authorUserId: e.authorUserId ?? null,
      })),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] audit write failed', err);
  }
}

/** Daily purge of entries past the retention window. Returns rows removed. */
export async function purgeOldAuditEntries(): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400 * 1000);
  try {
    const { count } = await prisma.metaAdsPacerAuditEntry.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  } catch {
    return 0;
  }
}

/** Format a money-ish field value for a human-readable summary. */
function fmtVal(field: string, v: string | null): string {
  if (v == null) return '—';
  const moneyFields = new Set([
    'pacerDailyBudget',
    'pacerActual',
    'allocation',
    'splitBaseAmount',
  ]);
  if (moneyFields.has(field)) {
    const n = Number(v);
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
  }
  return v;
}

/** "Daily budget $10.00 → $13.25" style one-liner for a field diff. */
export function summarizeDiff(adName: string, diff: AdFieldDiff): string {
  const label = TRACKED_AD_FIELDS[diff.field] ?? diff.field;
  return `${adName}: ${label} ${fmtVal(diff.field, diff.from)} → ${fmtVal(diff.field, diff.to)}`;
}
