/**
 * GoHighLevel (LeadConnector) email-reporting client.
 *
 * Port of Oz Dealer Tools' GoHighLevel V2 client. Auth is a per-sub-account
 * Private Integration Token (Bearer) + locationId — stored encrypted on the
 * Account. The /emails/schedule endpoint returns delivery counts (sent /
 * delivered / failed) but NOT engagement (opens / clicks / bounces) — those
 * require a marketplace OAuth app, so engagement fields default to 0 and the
 * report flags when none is present. normalizeCampaign + aggregateStats are
 * ported verbatim for parity.
 */

import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

export type GhlErrorCode = 'not_configured' | 'api_error';

export class GhlError extends Error {
  code: GhlErrorCode;
  httpStatus?: number;
  constructor(message: string, code: GhlErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'GhlError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface GhlCredentials {
  apiKey: string;
  locationId: string;
}

/** Stored secrets are `iv:tag:cipher` (3 base64 parts); anything else is plaintext. */
function readSecret(stored: string): string {
  if (stored.split(':').length === 3) {
    try {
      return decryptToken(stored);
    } catch {
      return stored;
    }
  }
  return stored;
}

/** Resolve this account's GHL Private Integration Token + locationId. */
export async function getGhlCredentials(accountKey: string): Promise<GhlCredentials> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { ghlApiKey: true, ghlLocationId: true },
  });
  const rawKey = account?.ghlApiKey?.trim();
  const locationId = account?.ghlLocationId?.trim();
  if (!rawKey || !locationId) {
    throw new GhlError(
      "GoHighLevel isn't connected for this account. Add a Private Integration token + location id in settings.",
      'not_configured',
    );
  }
  return { apiKey: readSecret(rawKey), locationId };
}

async function ghlGet<T>(creds: GhlCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Version: API_VERSION,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new GhlError(
      `Could not reach the GoHighLevel API: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;
  if (res.status >= 400) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new GhlError(`GoHighLevel: ${msg}`, 'api_error', res.status);
  }
  return (json ?? {}) as T;
}

// ── Normalization (Oz parity) ──

const int = (v: unknown) => Math.trunc(Number(v ?? 0)) || 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** GHL timestamps are unix ms (sometimes seconds, or already an ISO string). */
function tsToIso(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return typeof v === 'string' ? v : '';
  const seconds = n > 1e12 ? Math.floor(n / 1000) : n;
  return new Date(seconds * 1000).toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss (UTC)
}

export interface EmailBlast {
  id: string;
  name: string;
  status: string;
  subject: string;
  campaign_type: string;
  scheduled_at: string;
  created_at: string;
  sent: number;
  delivered: number;
  failed: number;
  errors: number;
  queued: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  complained: number;
  delivery_rate: number;
  fail_rate: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  unsub_rate: number;
}

type Raw = Record<string, unknown>;

/** Normalize a /emails/schedule row into our campaign shape (Oz parity). */
export function normalizeCampaign(raw: Raw): EmailBlast {
  const sent = int(raw.totalCount ?? raw.processed);
  const delivered = int(raw.successCount ?? raw.success);
  const failed = int(raw.failed);

  const c: EmailBlast = {
    id: String(raw.id ?? raw._id ?? ''),
    name: (raw.name as string) ?? 'Untitled',
    status: (raw.status as string) ?? (raw.emailStatus as string) ?? 'unknown',
    subject: (raw.subject as string) ?? '',
    campaign_type: (raw.campaignType as string) ?? '',
    scheduled_at: tsToIso(raw.dateScheduled ?? raw.nextExecution ?? raw.createdAt),
    created_at: tsToIso(raw.dateAdded ?? raw.createdAt),
    sent,
    delivered,
    failed,
    errors: int(raw.error),
    queued: int(raw.queuedCount),
    opened: int(raw.opened ?? raw.openedCount ?? raw.uniqueOpens),
    clicked: int(raw.clicked ?? raw.clickedCount ?? raw.uniqueClicks),
    bounced: int(raw.bounced ?? raw.bouncedCount ?? raw.hardBounced),
    unsubscribed: int(raw.unsubscribed ?? raw.unsubscribedCount),
    complained: int(raw.complained ?? raw.complainedCount ?? raw.spamComplaints),
    delivery_rate: sent > 0 ? round1((delivered / sent) * 100) : 0,
    fail_rate: sent > 0 ? round1((failed / sent) * 100) : 0,
    open_rate: 0,
    click_rate: 0,
    bounce_rate: 0,
    unsub_rate: 0,
  };

  // Engagement rates against the delivered/sent base (Oz parity).
  const base = Math.max(c.delivered, c.sent, 1);
  c.open_rate = round1((c.opened / base) * 100);
  c.click_rate = round1((c.clicked / base) * 100);
  c.bounce_rate = c.sent > 0 ? round1((c.bounced / c.sent) * 100) : 0;
  c.unsub_rate = round1((c.unsubscribed / base) * 100);
  return c;
}

/** Fetch + normalize all email campaigns for the location. */
export async function getEmailBlastsNormalized(creds: GhlCredentials): Promise<EmailBlast[]> {
  const res = await ghlGet<Raw>(creds, '/emails/schedule', { locationId: creds.locationId });
  // GHL returns the list under data / campaigns / schedules, or as the body itself.
  let list = (res.data ?? res.campaigns ?? res.schedules ?? res) as unknown;
  if (Array.isArray(list)) {
    // already a list
  } else if (list && typeof list === 'object') {
    list = [list];
  } else {
    list = [];
  }
  return (list as Raw[]).filter((item) => item && typeof item === 'object').map(normalizeCampaign);
}

export interface EmailAggregate {
  total_campaigns: number;
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  total_errors: number;
  total_opened: number;
  total_clicked: number;
  total_bounced: number;
  total_unsubscribed: number;
  total_complained: number;
  delivery_rate: number;
  fail_rate: number;
  avg_open_rate: number;
  avg_click_rate: number;
  avg_bounce_rate: number;
  avg_unsub_rate: number;
  avg_recipients: number;
  has_engagement: boolean;
}

/** Aggregate stats across campaigns (Oz parity). */
export function aggregateStats(campaigns: EmailBlast[]): EmailAggregate {
  const sum = (k: keyof EmailBlast) => campaigns.reduce((t, c) => t + (c[k] as number), 0);
  const total_sent = sum('sent');
  const total_delivered = sum('delivered');
  const total_failed = sum('failed');
  const total_opened = sum('opened');
  const total_clicked = sum('clicked');
  const total_bounced = sum('bounced');
  const total_unsubscribed = sum('unsubscribed');
  const total_campaigns = campaigns.length;
  const base = Math.max(total_delivered, total_sent, 1);

  return {
    total_campaigns,
    total_sent,
    total_delivered,
    total_failed,
    total_errors: sum('errors'),
    total_opened,
    total_clicked,
    total_bounced,
    total_unsubscribed,
    total_complained: sum('complained'),
    delivery_rate: total_sent > 0 ? round1((total_delivered / total_sent) * 100) : 0,
    fail_rate: total_sent > 0 ? round1((total_failed / total_sent) * 100) : 0,
    avg_open_rate: round1((total_opened / base) * 100),
    avg_click_rate: round1((total_clicked / base) * 100),
    avg_bounce_rate: total_sent > 0 ? round1((total_bounced / total_sent) * 100) : 0,
    avg_unsub_rate: round1((total_unsubscribed / base) * 100),
    avg_recipients: total_campaigns > 0 ? Math.round(total_sent / total_campaigns) : 0,
    has_engagement: total_opened + total_clicked + total_bounced > 0,
  };
}
