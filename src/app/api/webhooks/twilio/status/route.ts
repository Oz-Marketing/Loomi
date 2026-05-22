import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { verifyTwilioSignature } from '@/lib/sending/twilio';
import {
  processTwilioStatusCallback,
  type TwilioStatusCallbackPayload,
} from '@/lib/sending/twilio-events';

const SIGNATURE_HEADER = 'x-twilio-signature';

/**
 * POST /api/webhooks/twilio/status?accountKey=…
 *
 * Twilio status-callback target. Configure this URL in the worker when
 * sending a message; Twilio POSTs as messages transition through
 * queued/sent/delivered/undelivered/failed.
 *
 * Signature verification uses the per-sub-account Twilio Auth Token,
 * which we look up via the accountKey routed through the URL query.
 * Unsigned requests are rejected in production but allowed in dev so
 * curl-style local testing works without round-tripping Twilio.
 */
export async function POST(req: NextRequest) {
  const accountKey = req.nextUrl.searchParams.get('accountKey') || '';
  if (!accountKey) {
    return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  }

  // Twilio POSTs form-encoded data; parse before signature verification
  // because the signed payload includes the sorted form params.
  const rawBody = await req.text();
  const form = parseFormBody(rawBody);

  const signature = req.headers.get(SIGNATURE_HEADER) || '';
  const reconstructedUrl = reconstructPublicUrl(req);

  if (signature) {
    const authToken = await loadAuthToken(accountKey);
    if (!authToken) {
      return NextResponse.json(
        { error: 'No Twilio credentials configured for this sub-account' },
        { status: 400 },
      );
    }
    const ok = verifyTwilioSignature(authToken, signature, reconstructedUrl, form);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Missing X-Twilio-Signature' }, { status: 401 });
  }

  const payload: TwilioStatusCallbackPayload = {
    MessageSid: form.MessageSid || '',
    MessageStatus: form.MessageStatus || '',
    To: form.To,
    From: form.From,
    ErrorCode: form.ErrorCode,
    ErrorMessage: form.ErrorMessage,
    AccountSid: form.AccountSid,
    accountKey,
  };

  try {
    const created = await processTwilioStatusCallback(payload);
    return NextResponse.json({ processed: true, fresh: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process callback';
    console.error('[twilio:status] failed to process:', message);
    // Return 200 even on internal errors so Twilio doesn't infinitely
    // retry malformed payloads. We've already logged the failure.
    return NextResponse.json({ processed: false, error: message });
  }
}

function parseFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

/**
 * Reconstruct the URL Twilio originally called. Behind a reverse
 * proxy / Vercel / CDN the inbound req.url uses the internal host, so
 * we have to consult the X-Forwarded-* headers. Twilio's signature
 * is computed against the EXACT URL they called, including the query
 * string.
 */
function reconstructPublicUrl(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const path = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  return `${forwardedProto}://${forwardedHost}${path}${search}`;
}

async function loadAuthToken(accountKey: string): Promise<string | null> {
  const row = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { twilioAuthToken: true },
  });
  if (!row?.twilioAuthToken) return null;
  try {
    return decryptToken(row.twilioAuthToken);
  } catch {
    return null;
  }
}
