import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  getWarmupHolds,
  listEmailBlasts,
  type BlastSourceFilter,
  type EmailBlastSummary,
  type WarmupHold,
} from '@/lib/services/email-blasts';
import { listSmsBlasts, type SmsBlastSummary } from '@/lib/services/sms-blasts';
// Shared with the engagement aggregation so the number of rows this can return
// never exceeds the number it can supply metrics for.
import { CAMPAIGN_ROW_LIMIT } from '@/lib/services/email-analytics';

/**
 * GET /api/blasts/loomi/list?accountKey=<key>
 *
 * Returns every Loomi-native campaign (EmailBlast + SmsBlast) for
 * the given account, mapped into the same Campaign shape the campaigns
 * list page already renders. Drafts are included on purpose — without
 * this, the user has no way to resume them from the campaigns list.
 *
 * If accountKey is omitted, returns campaigns across every account the
 * caller can see (used by the admin-level Campaigns page).
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  const role = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  // Role-based access check on the requested accountKey.
  if (accountKey) {
    if (role === 'client' && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ campaigns: [] });
    }
    if (role === 'admin' && userAccountKeys.length > 0 && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ campaigns: [] });
    }
  }

  // Scope at the service layer to the user's visible accounts (when
  // applicable).
  let visibilityScope: string[] | undefined;
  if (role === 'client' || (role === 'admin' && userAccountKeys.length > 0)) {
    visibilityScope = userAccountKeys;
  }

  // ?status=all (default) hides archived rows; ?status=archived shows
  // only archived. Legacy ?includeArchived=1 maps to status=archived so
  // older callers keep working.
  const statusParam = req.nextUrl.searchParams.get('status');
  const legacyIncludeArchived =
    req.nextUrl.searchParams.get('includeArchived') === '1';
  const statusFilter: 'all' | 'archived' =
    statusParam === 'archived' || legacyIncludeArchived ? 'archived' : 'all';

  // ?source=blasts (default) returns only human-composed campaigns.
  // 'flows' returns only the per-(flow, node) wrapper shells the flow
  // engine sends through; 'all' returns both. See BlastSourceFilter.
  const sourceParam = req.nextUrl.searchParams.get('source');
  const source: BlastSourceFilter =
    sourceParam === 'flows' || sourceParam === 'all' ? sourceParam : 'blasts';

  // Narrow to the requested account IN THE QUERY. Filtering after a
  // platform-wide `take` let an account's own blast — a scheduled one
  // included — fall off its own list once the platform had more blasts than
  // the cap, with no way to find it to cancel it.
  //
  // An account's list shows ONLY that account's blasts. Blasts with no
  // account used to show in every account's view, so one made while a group
  // was selected appeared in the group and in each of its rooftops, as if
  // every child had been given a copy. The create and PATCH routes no longer
  // allow a blast without an account (lib/services/blast-account-keys).
  const listScope = accountKey
    ? { accountKeys: [accountKey] }
    : { accountKeys: visibilityScope };
  const [emails, sms] = await Promise.all([
    listEmailBlasts({ limit: CAMPAIGN_ROW_LIMIT, ...listScope, statusFilter, source }),
    listSmsBlasts({ limit: CAMPAIGN_ROW_LIMIT, ...listScope, statusFilter, source }),
  ]);

  function matchesAccount(accountKeys: string[]): boolean {
    if (!accountKey) return true;
    return accountKeys.includes(accountKey);
  }

  // Clients can never see drafts — drafts are in-progress work, and the
  // client role is read-only over scheduled/sent campaigns. Admin and up
  // get everything so they can resume their own drafts from this list.
  function matchesStatusForRole(status: string): boolean {
    if (role !== 'client') return true;
    const s = status.toLowerCase();
    return s === 'scheduled' || s === 'queued' || s === 'processing' ||
      s === 'completed' || s === 'sent';
  }

  // A blast parked by its sending domain's daily warm-up cap sits in
  // 'processing' with no outward sign it will ever move. Resolve the reason
  // for those rows so the list can say so instead of showing a bare badge.
  const warmupHolds = await getWarmupHolds(
    emails.filter((c) => c.status === 'processing').map((c) => c.id),
  );

  // Collapse multi-channel pairs into a single row anchored on the email
  // campaign. The SMS half is dropped from the list so we don't show two
  // entries for one logical campaign — the channel badge reads "Email + SMS"
  // and the row's id remains the email campaign id (canonical group id).
  const linkedSmsIdsOnEmails = new Set<string>();
  for (const e of emails) {
    const meta = parseMeta(e.metadata);
    if (meta?.multiChannel && typeof meta.linkedSmsBlastId === 'string') {
      linkedSmsIdsOnEmails.add(meta.linkedSmsBlastId);
    }
  }

  // Archive filter is now applied at the DB layer via archivedAt in
  // listEmailBlasts / listSmsBlasts — we no longer need to drop
  // archived rows here. Legacy archived rows that still rely on
  // metadata.archived are backfilled by a one-time migration; if any
  // slip through, the metadata fallback below keeps them hidden when
  // viewing the live list.
  const campaigns = [
    ...emails
      .filter((c) => matchesAccount(c.accountKeys))
      .filter((c) => matchesStatusForRole(c.status))
      .filter((c) => statusFilter === 'archived' || !isArchived(c.metadata))
      .map((c) => mapEmail(c, warmupHolds.get(c.id))),
    ...sms
      .filter((c) => matchesAccount(c.accountKeys))
      .filter((c) => matchesStatusForRole(c.status))
      .filter((c) => statusFilter === 'archived' || !isArchived(c.metadata))
      // Drop SMS rows that are the SMS half of a linked multi-channel pair.
      .filter((c) => !linkedSmsIdsOnEmails.has(c.id))
      .map((c) => mapSms(c)),
  ];

  // Newest first (createdAt desc). Drafts and scheduled mix in by time.
  campaigns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return NextResponse.json({ campaigns });
}

function parseMeta(raw: string | null | undefined): { multiChannel?: boolean; linkedSmsBlastId?: string; archived?: boolean } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isArchived(metadata: string | null | undefined): boolean {
  return Boolean(parseMeta(metadata)?.archived);
}

/** Pull the flow id out of a wrapper's "Flow:<flowId>/Node:<nodeId>"
 *  key so the row can deep-link back to the flow it belongs to. */
function flowIdFromKey(flowNodeKey: string): string | undefined {
  const match = /^Flow:([^/]+)\/Node:/.exec(flowNodeKey);
  return match ? match[1] : undefined;
}

function mapEmail(c: EmailBlastSummary, warmupHold?: WarmupHold) {
  const meta = parseMeta(c.metadata);
  const isMulti = Boolean(meta?.multiChannel && meta?.linkedSmsBlastId);
  return {
    warmupHold,
    id: c.id,
    campaignId: c.id,
    isFlow: Boolean(c.flowNodeKey),
    flowId: flowIdFromKey(c.flowNodeKey),
    name: c.name || '(Untitled email campaign)',
    status: c.status,
    provider: 'loomi-email',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    scheduledAt: c.scheduledFor || undefined,
    sentAt: c.completedAt || undefined,
    sentCount: c.sentCount,
    accountKey: c.accountKeys[0] || undefined,
    totalRecipients: c.totalRecipients,
    failedCount: c.failedCount,
    // A paused send keeps its status and says why here ("Paused: …").
    error: c.error || undefined,
    channel: (isMulti ? 'multi' : 'email') as 'multi' | 'email',
  };
}

function mapSms(c: SmsBlastSummary) {
  return {
    id: c.id,
    campaignId: c.id,
    isFlow: Boolean(c.flowNodeKey),
    flowId: flowIdFromKey(c.flowNodeKey),
    name: c.name || '(Untitled SMS campaign)',
    status: c.status,
    provider: 'loomi-sms',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    scheduledAt: c.scheduledFor || undefined,
    sentAt: c.completedAt || undefined,
    sentCount: c.sentCount,
    accountKey: c.accountKeys[0] || undefined,
    totalRecipients: c.totalRecipients,
    failedCount: c.failedCount,
    error: c.error || undefined,
    channel: 'sms' as const,
  };
}
