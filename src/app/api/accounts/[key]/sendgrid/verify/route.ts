import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { verifySendGridKey } from '@/lib/sending/sendgrid';
import { checkSenderDomainAuth, type DomainAuthResult } from '@/lib/sending/domain-auth';

interface RouteParams {
  params: Promise<{ key: string }>;
}


/**
 * POST /api/accounts/[key]/sendgrid/verify
 *
 * Body: { apiKey?: string, senderEmail?: string, fromDomain?: string }
 *
 * Two modes:
 * - If apiKey is provided, verify that key without persisting it. Use
 *   case: the settings UI lets the user paste a key and click "Verify
 *   Connection" before deciding to save.
 * - If apiKey is omitted, verify the currently-stored key. Use case:
 *   "is my saved config still working?" check.
 *
 * Also reports whether the domain blasts are sent FROM is authenticated in
 * SendGrid — the same check (lib/sending/domain-auth.ts) the send preflight
 * runs, so this screen and the Schedule step can never disagree. A fresh
 * answer here also refreshes the one preflight uses. The From address is
 * `senderEmail` from the body, else the account's saved From address; with
 * neither, the recorded sending domain is checked as if mail came from it.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('integrations.credentials.manage');
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const bodyKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const bodyDomain = typeof body.fromDomain === 'string' ? body.fromDomain.trim() : '';
  const bodySender = typeof body.senderEmail === 'string' ? body.senderEmail.trim() : '';

  const row = await prisma.account.findUnique({
    where: { key },
    select: { sendgridApiKey: true, sendgridFromDomain: true, senderEmail: true },
  });

  let plaintextKey: string | null = null;
  if (bodyKey) {
    plaintextKey = bodyKey;
  } else {
    if (!row?.sendgridApiKey) {
      return NextResponse.json(
        { ok: false, error: 'No SendGrid API key configured for this account.' },
        { status: 400 },
      );
    }
    try {
      plaintextKey = decryptToken(row.sendgridApiKey);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Stored API key could not be decrypted (re-save it).' },
        { status: 500 },
      );
    }
  }

  if (!plaintextKey) {
    return NextResponse.json(
      { ok: false, error: 'No API key to verify.' },
      { status: 400 },
    );
  }
  const verify = await verifySendGridKey(plaintextKey);

  const fallbackDomain = (bodyDomain || row?.sendgridFromDomain || '').replace(/^@+/, '');
  const fromEmail = bodySender || row?.senderEmail || (fallbackDomain ? `postmaster@${fallbackDomain}` : '');
  let domainAuth: DomainAuthResult | null = null;
  if (verify.ok && fromEmail) {
    domainAuth = await checkSenderDomainAuth({ apiKey: plaintextKey, fromEmail, fresh: true });
  }

  return NextResponse.json({
    ok: verify.ok,
    error: verify.error,
    scopes: verify.scopes,
    // `domain` keeps the shape the Sending Config tab already renders.
    domain: domainAuth
      ? {
          domain: domainAuth.fromDomain,
          valid: domainAuth.status === 'authenticated',
          status: domainAuth.status,
          detail: domainAuth.detail,
          authenticatedDomain: domainAuth.authenticatedDomain,
        }
      : null,
    domainAuth,
  });
}
