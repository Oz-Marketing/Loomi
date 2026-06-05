import { NextRequest, NextResponse } from 'next/server';
import type { Contact, FormSubmission } from '@prisma/client';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { buildAdfXml, buildAdfSubject } from '@/lib/integrations/crm/adf';
import { sendLeadEmail, LeadEmailError } from '@/lib/integrations/crm/send-lead-email';
import { parseLeadEmails } from '@/lib/integrations/crm/lead-emails';

interface RouteParams {
  params: Promise<{ key: string; id: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * POST /api/accounts/[key]/crm/[id]/test
 *
 * Builds a sample ADF lead and emails it to the destination's lead address
 * right now, so the operator can confirm the CRM accepts it before any
 * real lead comes through. Does not write a CrmDelivery row.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key, id } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const destination = await prisma.crmDestination.findUnique({ where: { id } });
  if (!destination || destination.accountKey !== key) {
    return NextResponse.json({ error: 'CRM destination not found' }, { status: 404 });
  }

  const account = await prisma.account.findUnique({
    where: { key },
    select: { dealer: true },
  });
  const form = await prisma.form.findFirst({
    where: { accountKey: key },
    select: { name: true },
    orderBy: { createdAt: 'desc' },
  });

  const adfInput = {
    dealerName: account?.dealer || key,
    formName: form?.name || 'Sample Form',
    submission: {
      data: {
        firstName: 'Sample',
        lastName: 'Lead',
        email: 'sample.lead@example.com',
        phone: '+15555550123',
        message: 'This is a Loomi CRM test lead.',
      },
      createdAt: new Date(),
      utmSource: 'loomi-test',
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    } as unknown as FormSubmission,
    contact: {
      email: 'sample.lead@example.com',
      phone: '+15555550123',
      firstName: 'Sample',
      lastName: 'Lead',
    } as unknown as Contact,
  };

  const startedAt = Date.now();
  try {
    const { messageId } = await sendLeadEmail({
      accountKey: key,
      to: parseLeadEmails(destination.leadEmails),
      subject: buildAdfSubject(adfInput),
      xml: buildAdfXml(adfInput),
    });
    return NextResponse.json({ ok: true, messageId, latencyMs: Date.now() - startedAt });
  } catch (err) {
    const message =
      err instanceof LeadEmailError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Send failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
