// Per-event ingestion (service appointments + vehicle purchases) — the history
// the Contact row collapses. Each event upserts idempotently on its
// idempotencyKey (source RO/deal id) and links to a contact by the same
// (accountKey, email → phone) identity the contact ingest uses.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normaliseEmail, normalisePhone, parseDateCell } from './normalize';

export type ContactEventType = 'service' | 'sale';

export interface IngestEventInput {
  /** Stable per source record, e.g. "cdk:svc:{dealer}:{ro}". Required. */
  idempotencyKey: string;
  type: ContactEventType;
  /** Identity used to link the event to a contact. */
  email?: string | null;
  phone?: string | null;
  eventDate?: string | Date | null;
  amount?: number | string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleVin?: string | null;
  vehicleMileage?: string | null;
  sourceCrm?: string | null;
  reference?: string | null;
  details?: Record<string, unknown> | null;
}

export interface IngestEventsSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  issues: { index: number; reason: string }[];
}

export interface IngestEventsOptions {
  accountKey: string;
  events: IngestEventInput[];
}

const MAX_ISSUES = 50;

function coerceDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  return parseDateCell(String(v));
}

function coerceAmount(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function str(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

export async function ingestEvents({
  accountKey,
  events,
}: IngestEventsOptions): Promise<IngestEventsSummary> {
  const issues: IngestEventsSummary['issues'] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Resolve contactId once per distinct identity to avoid repeat lookups
  // across a dealer's batch (many events share a customer).
  const contactCache = new Map<string, string | null>();

  async function findContactId(email: string | null, phone: string | null): Promise<string | null> {
    const cacheKey = `${email ?? ''}|${phone ?? ''}`;
    if (contactCache.has(cacheKey)) return contactCache.get(cacheKey)!;
    let id: string | null = null;
    if (email) {
      const c = await prisma.contact.findUnique({
        where: { accountKey_email: { accountKey, email } },
        select: { id: true },
      });
      if (c) id = c.id;
    }
    if (!id && phone) {
      const c = await prisma.contact.findUnique({
        where: { accountKey_phone: { accountKey, phone } },
        select: { id: true },
      });
      if (c) id = c.id;
    }
    contactCache.set(cacheKey, id);
    return id;
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const key = str(e.idempotencyKey);
    if (!key || (e.type !== 'service' && e.type !== 'sale')) {
      skipped += 1;
      if (issues.length < MAX_ISSUES) {
        issues.push({ index: i, reason: 'Missing idempotencyKey or invalid type' });
      }
      continue;
    }

    const email = e.email ? normaliseEmail(String(e.email)) || null : null;
    const phone = e.phone ? normalisePhone(String(e.phone)) || null : null;

    try {
      const contactId = await findContactId(email, phone);

      const data = {
        accountKey,
        contactId,
        type: e.type,
        eventDate: coerceDate(e.eventDate),
        amount: coerceAmount(e.amount),
        vehicleYear: str(e.vehicleYear),
        vehicleMake: str(e.vehicleMake),
        vehicleModel: str(e.vehicleModel),
        vehicleVin: str(e.vehicleVin),
        vehicleMileage: str(e.vehicleMileage),
        sourceCrm: str(e.sourceCrm),
        reference: str(e.reference),
        details:
          e.details && Object.keys(e.details).length > 0
            ? (e.details as Prisma.InputJsonValue)
            : undefined,
      };

      const existing = await prisma.contactEvent.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });

      if (existing) {
        await prisma.contactEvent.update({ where: { idempotencyKey: key }, data });
        updated += 1;
      } else {
        await prisma.contactEvent.create({ data: { idempotencyKey: key, ...data } });
        created += 1;
      }
    } catch (err) {
      skipped += 1;
      if (issues.length < MAX_ISSUES) {
        issues.push({ index: i, reason: err instanceof Error ? err.message : 'Upsert failed' });
      }
    }
  }

  return { totalRows: events.length, created, updated, skipped, issues };
}
