import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/esp/encryption';
import { verifyTwilioSignature } from '@/lib/sending/twilio';
import {
  processTwilioInbound,
  type TwilioInboundPayload,
} from '@/lib/sending/twilio-events';

const SIGNATURE_HEADER = 'x-twilio-signature';

/**
 * POST /api/webhooks/twilio/inbound?accountKey=…
 *
 * Inbound-message webhook. Configure on your Twilio phone number or
 * Messaging Service as the "A message comes in" target. We respond
 * with empty TwiML — Twilio handles STOP keywords at the carrier
 * level automatically, our side effect is just persisting the
 * suppression locally so the campaign scheduler honours it without
 * a Twilio call.
 */
export async function POST(req: NextRequest) {
  const accountKey = req.nextUrl.searchParams.get('accountKey') || '';
  if (!accountKey) {
    return new NextResponse('<Response/>', {
      status: 400,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const rawBody = await req.text();
  const form = parseFormBody(rawBody);

  const signature = req.headers.get(SIGNATURE_HEADER) || '';
  const reconstructedUrl = reconstructPublicUrl(req);

  if (signature) {
    const authToken = await loadAuthToken(accountKey);
    if (!authToken) {
      return new NextResponse('<Response/>', {
        status: 400,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    const ok = verifyTwilioSignature(authToken, signature, reconstructedUrl, form);
    if (!ok) {
      return new NextResponse('<Response/>', {
        status: 401,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return new NextResponse('<Response/>', {
      status: 401,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const payload: TwilioInboundPayload = {
    MessageSid: form.MessageSid || '',
    From: form.From || '',
    To: form.To,
    Body: form.Body,
    AccountSid: form.AccountSid,
    accountKey,
  };

  try {
    await processTwilioInbound(payload);
  } catch (err) {
    console.error('[twilio:inbound] failed to process:', err);
    // Log and move on — we still want to ACK the webhook so Twilio
    // doesn't retry on our internal issues.
  }

  // Reply with empty TwiML so Twilio doesn't send an auto-response.
  // STOP confirmation messages are handled by the carrier / Twilio
  // platform per A2P 10DLC rules.
  return new NextResponse('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

function parseFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

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
