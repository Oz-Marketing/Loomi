import { prisma } from '@/lib/prisma';
import { getBoss } from '@/lib/queue/boss';
import { createNotification } from '@/lib/notifications/service';
import type { RowIssue } from './normalize';
import {
  commitContactRows,
  loadDateCustomFieldKeys,
  parseImportRows,
  type ImportMapping,
} from './import';

/**
 * CSV contact import, as a background job.
 *
 * ── Why this is not an HTTP request ──
 *
 * It used to be. The commit upserted every row inside the upload request, and
 * each row is two or three round trips to the database, so a 12,000-row file
 * is tens of thousands of queries. Production nginx cuts an upstream request
 * at 60 seconds: the page showed "Import failed" while the server kept writing
 * behind it, and the person had to sit on the page the whole time either way.
 *
 * So the route stores the file on a `ContactImportRun` and returns, and this
 * runs on the worker in chunks, saving progress after each one. The import
 * page, the Contacts screen and a bell notification all read the row.
 */

export const CONTACT_IMPORT_QUEUE = 'loomi.contacts.import';

export interface ContactImportJob {
  runId: string;
}

/** Rows per progress write. Small enough that the bar moves, large enough
 *  that the extra UPDATE is noise next to the upserts. */
const CHUNK_SIZE = 250;

/** Issues kept on the run for the person to read. */
const MAX_ISSUES_STORED = 200;

let queueEnsured = false;

async function ensureQueue(): Promise<void> {
  if (queueEnsured) return;
  const boss = await getBoss();
  await boss.createQueue(CONTACT_IMPORT_QUEUE);
  queueEnsured = true;
}

/**
 * Hand a created run to the worker. Throws on failure so the route can mark
 * the run failed instead of leaving a `queued` row nothing will pick up.
 */
export async function enqueueContactImportJob(runId: string): Promise<void> {
  await ensureQueue();
  const boss = await getBoss();
  const job: ContactImportJob = { runId };
  await boss.send(CONTACT_IMPORT_QUEUE, job, {
    // A retry resumes from `processedRows` rather than starting over, and
    // every write in a chunk is idempotent, so retrying after a worker restart
    // is safe — at worst it redoes part of one chunk.
    retryLimit: 2,
    retryDelay: 30,
    // Big files on the managed database take a while, so the ceiling is
    // generous. A worker killed mid-run (a deploy, a pm2 restart) is caught by
    // the heartbeat instead: the worker beats while the handler runs, and a
    // job that goes quiet for two minutes is retried, resuming where it was.
    expireInSeconds: 4 * 3600,
    heartbeatSeconds: 120,
    singletonKey: runId,
  });
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function runContactImportJob(runId: string): Promise<void> {
  const run = await prisma.contactImportRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.warn(`[contact-import-job] run ${runId} not found`);
    return;
  }
  if (run.status === 'done' || run.status === 'failed') {
    console.warn(`[contact-import-job] run ${runId} is already ${run.status}; skipping`);
    return;
  }

  const mapping = safeJson<ImportMapping>(run.mapping);
  if (!mapping) {
    await finishFailed(runId, 'The column mapping could not be read.');
    return;
  }
  const applyTags = safeJson<string[]>(run.applyTags) ?? [];

  const rows = parseImportRows(run.csvText);
  const issues = safeJson<RowIssue[]>(run.issues) ?? [];
  const totals = {
    processedRows: run.processedRows,
    imported: run.imported,
    updated: run.updated,
    skipped: run.skipped,
    optedOutEmail: run.optedOutEmail,
    optedOutSms: run.optedOutSms,
    listMembershipsAdded: run.listMembershipsAdded,
  };

  await prisma.contactImportRun.update({
    where: { id: runId },
    data: { status: 'running', totalRows: rows.length },
  });

  try {
    const dateCustomFieldKeys = await loadDateCustomFieldKeys(run.accountKey);

    // A retry starts where the last saved chunk left off.
    for (let start = totals.processedRows; start < rows.length; start += CHUNK_SIZE) {
      const slice = rows.slice(start, start + CHUNK_SIZE);
      const chunk = await commitContactRows({
        accountKey: run.accountKey,
        rows: slice,
        firstRowIndex: start,
        mapping,
        dateCustomFieldKeys,
        listId: run.listId ?? undefined,
        applyTags,
        preserveExistingOnMatch: run.preserveExisting,
        importedBy: run.startedByUserId ?? undefined,
      });

      totals.processedRows = start + slice.length;
      totals.imported += chunk.imported;
      totals.updated += chunk.updated;
      totals.skipped += chunk.skipped;
      totals.optedOutEmail += chunk.optedOut.email;
      totals.optedOutSms += chunk.optedOut.sms;
      totals.listMembershipsAdded += chunk.listMembershipsAdded;
      for (const issue of chunk.issues) {
        if (issues.length >= MAX_ISSUES_STORED) break;
        issues.push(issue);
      }

      await prisma.contactImportRun.update({
        where: { id: runId },
        data: { ...totals, issues: JSON.stringify(issues) },
      });
    }
  } catch (err) {
    // Rethrown so pg-boss retries; the run stays `running` and the retry
    // resumes. Only the final attempt's failure is worth recording, but we
    // can't tell which attempt this is from here, so note the error now —
    // a successful retry clears it.
    await prisma.contactImportRun.update({
      where: { id: runId },
      data: { error: err instanceof Error ? err.message : 'Unknown error' },
    });
    throw err;
  }

  await prisma.contactImportRun.update({
    where: { id: runId },
    // Drop the file: the contacts are in the database now, and a finished
    // import has no reason to keep a second copy of everyone's details.
    data: { status: 'done', error: null, csvText: '', finishedAt: new Date() },
  });

  await notifyFinished(run.startedByUserId, run.fileName, run.listId, totals);
}

async function finishFailed(runId: string, error: string): Promise<void> {
  await prisma.contactImportRun.update({
    where: { id: runId },
    data: { status: 'failed', error, csvText: '', finishedAt: new Date() },
  });
}

/**
 * Mark a run failed after pg-boss gives up on it, so the screen stops showing
 * a progress bar for a job nobody is running. Called from the worker's
 * failure path.
 */
export async function markContactImportFailed(runId: string, error: string): Promise<void> {
  const run = await prisma.contactImportRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run || run.status === 'done' || run.status === 'failed') return;
  await finishFailed(runId, error);
}

async function notifyFinished(
  userId: string | null,
  fileName: string | null,
  listId: string | null,
  totals: { imported: number; updated: number; skipped: number },
): Promise<void> {
  if (!userId) return;
  const name = fileName ? `"${fileName}"` : 'Your contact import';
  try {
    await createNotification({
      userId,
      type: 'contact_import_finished',
      severity: totals.skipped > 0 ? 'warning' : 'info',
      title: `${name} finished importing`,
      body:
        `${totals.imported.toLocaleString()} new, ${totals.updated.toLocaleString()} updated` +
        (totals.skipped > 0 ? `, ${totals.skipped.toLocaleString()} skipped.` : '.'),
      link: listId ? `/contacts/lists/${listId}` : '/contacts',
      meta: { ...totals, listId },
    });
  } catch (err) {
    console.warn('[contact-import-job] completion notification failed:', err);
  }
}
