import type { ContactImportRun } from '@prisma/client';
import type { RowIssue } from './normalize';

/**
 * What the screen reads about a contact import. Projected explicitly so the
 * stored CSV — everyone's contact details — never rides along to the browser.
 */
export interface ContactImportRunDto {
  id: string;
  accountKey: string;
  fileName: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  /** A `running` row that hasn't moved in a while — the worker likely died. */
  stalled: boolean;
  listId: string | null;
  totalRows: number;
  processedRows: number;
  imported: number;
  updated: number;
  skipped: number;
  optedOut: { email: number; sms: number };
  listMembershipsAdded: number;
  issues: RowIssue[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A chunk is a few seconds of work; this long without a write means nobody is running it. */
const STALLED_AFTER_MS = 10 * 60 * 1000;

export function serializeImportRun(run: ContactImportRun, now = Date.now()): ContactImportRunDto {
  const status = (['queued', 'running', 'done', 'failed'] as const).find((s) => s === run.status) ?? 'queued';
  let issues: RowIssue[] = [];
  if (run.issues) {
    try {
      const parsed = JSON.parse(run.issues);
      if (Array.isArray(parsed)) issues = parsed;
    } catch {
      // A malformed blob just means no issue detail to show.
    }
  }
  return {
    id: run.id,
    accountKey: run.accountKey,
    fileName: run.fileName,
    status,
    stalled:
      (status === 'running' || status === 'queued') &&
      now - run.updatedAt.getTime() > STALLED_AFTER_MS,
    listId: run.listId,
    totalRows: run.totalRows,
    processedRows: run.processedRows,
    imported: run.imported,
    updated: run.updated,
    skipped: run.skipped,
    optedOut: { email: run.optedOutEmail, sms: run.optedOutSms },
    listMembershipsAdded: run.listMembershipsAdded,
    issues,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

/**
 * May this user see or start imports for `accountKey`? Mirrors the import
 * route's long-standing rule: developers and super admins reach every
 * account, an admin with no explicit assignments is unrestricted, and
 * everyone else is held to their assigned accounts.
 */
export function canImportForAccount(
  user: { role?: string | null; accountKeys?: string[] | null },
  accountKey: string,
): boolean {
  if (user.role === 'developer' || user.role === 'super_admin') return true;
  const assigned = user.accountKeys ?? [];
  if (user.role === 'admin' && assigned.length === 0) return true;
  return assigned.includes(accountKey);
}
