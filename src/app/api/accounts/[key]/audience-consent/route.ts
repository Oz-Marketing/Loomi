// GET/PUT /api/accounts/[key]/audience-consent
//
// Records a sub-account's attestation that its CRM data was collected
// first-party, with disclosure permitting use for third-party
// advertising. Without it the eligibility gate refuses to produce an
// export for the account.
//
// Stored per sub-account because that's the level the statement is
// actually true at — one rooftop's intake forms and privacy policy say
// nothing about another's. Who attested and when are both recorded, so
// the answer to "on what basis did we upload this list" isn't folklore.

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ key: string }> };

/** The bases we recognise. Free text would make this unauditable. */
const CONSENT_BASES = new Set(['first_party_disclosure']);

export async function GET(_req: Request, { params }: RouteContext) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const { key } = await params;
  if (!canAccess(session!.user, key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const account = await prisma.account.findUnique({
    where: { key },
    select: {
      audienceSyncConsentBasis: true,
      audienceSyncConsentAt: true,
      audienceSyncConsentBy: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  return NextResponse.json({
    consent: {
      basis: account.audienceSyncConsentBasis,
      recordedAt: account.audienceSyncConsentAt,
      recordedBy: account.audienceSyncConsentBy,
      recorded: !!(account.audienceSyncConsentBasis && account.audienceSyncConsentAt),
    },
  });
}

/**
 * Record or withdraw the attestation.
 *
 * Restricted to developer / super_admin. This is a compliance statement
 * about how a business collected its data, not a feature toggle — the
 * person clicking it should be someone who can actually answer for it.
 */
export async function PUT(req: Request, { params }: RouteContext) {
  const { session, error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  const { key } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Withdrawal: clears the attestation, which immediately blocks exports
  // for this account.
  if (body.basis === null) {
    await prisma.account.update({
      where: { key },
      data: {
        audienceSyncConsentBasis: null,
        audienceSyncConsentAt: null,
        audienceSyncConsentBy: null,
      },
    });
    return NextResponse.json({ consent: { recorded: false } });
  }

  const basis = typeof body.basis === 'string' ? body.basis.trim() : '';
  if (!CONSENT_BASES.has(basis)) {
    return NextResponse.json(
      { error: `basis must be one of: ${[...CONSENT_BASES].join(', ')}` },
      { status: 400 },
    );
  }
  // Require the caller to state it explicitly, so this can't be set as a
  // side effect of some other settings save.
  if (body.attest !== true) {
    return NextResponse.json(
      { error: 'attest must be true to record a consent basis' },
      { status: 400 },
    );
  }

  const updated = await prisma.account.update({
    where: { key },
    data: {
      audienceSyncConsentBasis: basis,
      audienceSyncConsentAt: new Date(),
      audienceSyncConsentBy: session!.user.id,
    },
    select: {
      audienceSyncConsentBasis: true,
      audienceSyncConsentAt: true,
      audienceSyncConsentBy: true,
    },
  });

  return NextResponse.json({
    consent: {
      basis: updated.audienceSyncConsentBasis,
      recordedAt: updated.audienceSyncConsentAt,
      recordedBy: updated.audienceSyncConsentBy,
      recorded: true,
    },
  });
}

function canAccess(
  user: { role: string; accountKeys?: string[] | null },
  accountKey: string,
): boolean {
  if (user.role === 'developer' || user.role === 'super_admin') return true;
  const keys = user.accountKeys ?? [];
  return keys.length === 0 || keys.includes(accountKey);
}
