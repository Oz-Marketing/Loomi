// Twilio client for per-sub-account SMS/MMS sending.
//
// Mirrors the SendGrid client shape — direct fetch, no SDK, three
// endpoints we care about:
//   - POST /Accounts/{sid}/Messages.json  — send a message
//   - GET  /Accounts/{sid}.json           — verify creds
//   - GET  /Accounts/{sid}/Messages/{messageSid}.json — status lookup
//
// Account SID + Auth Token live encrypted on the Account row;
// resolveTwilioConfig is the only call site that decrypts them.
//
// Twilio recommends Messaging Services for scaled sending (A2P 10DLC
// compliance, sticky sender, automatic number fallback). When a sub-
// account has a messagingServiceSid set we prefer it; otherwise we fall
// back to the single phoneNumber field.

import { prisma } from '@/lib/prisma';
import { decryptToken, encryptToken } from '@/lib/esp/encryption';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';
const REQUEST_TIMEOUT_MS = 15_000;

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string | null;
  messagingServiceSid: string | null;
}

export interface TwilioSendInput {
  accountSid: string;
  authToken: string;
  /** Either a Twilio phone number (E.164, e.g. "+12025551234") or a
   *  Messaging Service SID (starts with MG…). messagingServiceSid wins
   *  when both are present. */
  from: { phoneNumber: string | null; messagingServiceSid: string | null };
  /** Recipient phone number in E.164 format (e.g. "+15551234567"). */
  to: string;
  body: string;
  /** Optional media URLs for MMS. Twilio accepts up to 10 per message. */
  mediaUrls?: string[];
  /** Webhook URL Twilio POSTs delivery status updates to. Set to our
   *  /api/webhooks/twilio/status endpoint to feed SmsEvent rows. */
  statusCallback?: string;
}

export interface TwilioSendResult {
  /** Twilio's `sid` for this message (starts with SM…). Stored on the
   *  recipient row so the status-callback webhook can join events back
   *  to the originating SmsCampaignRecipient. */
  messageSid: string;
  /** Status at submit time: queued | accepted | sending. Final state
   *  arrives via the status callback. */
  status: string;
}

export class TwilioError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly twilioCode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

function buildBasicAuth(sid: string, token: string): string {
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/**
 * Resolve a sub-account's Twilio config. Returns null when no Account
 * SID is configured — callers fall back to the legacy GHL Conversations
 * API send path.
 *
 * Decryption errors throw rather than silently returning null so a
 * misconfigured account fails loudly with a clear error message instead
 * of routing through the wrong transport.
 */
export async function resolveTwilioConfig(
  accountKey: string,
): Promise<TwilioConfig | null> {
  const row = await prisma.account.findUnique({
    where: { key: accountKey },
    select: {
      twilioAccountSid: true,
      twilioAuthToken: true,
      twilioPhoneNumber: true,
      twilioMessagingServiceSid: true,
    },
  });
  if (!row?.twilioAccountSid || !row?.twilioAuthToken) return null;
  return {
    accountSid: decryptToken(row.twilioAccountSid),
    authToken: decryptToken(row.twilioAuthToken),
    phoneNumber: row.twilioPhoneNumber || null,
    messagingServiceSid: row.twilioMessagingServiceSid || null,
  };
}

/**
 * Persist Twilio creds. Passing `null` for accountSid/authToken clears
 * both — the worker then falls back to the legacy GHL path.
 */
export async function setTwilioCredentials(
  accountKey: string,
  creds: {
    accountSid?: string | null;
    authToken?: string | null;
    phoneNumber?: string | null;
    messagingServiceSid?: string | null;
  },
): Promise<void> {
  const data: {
    twilioAccountSid?: string | null;
    twilioAuthToken?: string | null;
    twilioPhoneNumber?: string | null;
    twilioMessagingServiceSid?: string | null;
  } = {};
  if ('accountSid' in creds) {
    data.twilioAccountSid = creds.accountSid ? encryptToken(creds.accountSid) : null;
  }
  if ('authToken' in creds) {
    data.twilioAuthToken = creds.authToken ? encryptToken(creds.authToken) : null;
  }
  if ('phoneNumber' in creds) {
    data.twilioPhoneNumber = creds.phoneNumber || null;
  }
  if ('messagingServiceSid' in creds) {
    data.twilioMessagingServiceSid = creds.messagingServiceSid || null;
  }
  await prisma.account.update({ where: { key: accountKey }, data });
}

/**
 * Fire a single SMS or MMS through Twilio's Messages API.
 *
 * Returns the Twilio message SID + initial status. Throws TwilioError
 * on non-2xx responses with the structured error message + code from
 * Twilio's response body (so callers can surface "Invalid 'To' phone
 * number" rather than "Twilio send failed (400)").
 */
export async function sendSmsViaTwilio(
  input: TwilioSendInput,
): Promise<TwilioSendResult> {
  // Twilio's Messages endpoint is form-encoded, not JSON.
  const form = new URLSearchParams();
  form.set('To', input.to);
  form.set('Body', input.body);

  if (input.from.messagingServiceSid) {
    form.set('MessagingServiceSid', input.from.messagingServiceSid);
  } else if (input.from.phoneNumber) {
    form.set('From', input.from.phoneNumber);
  } else {
    throw new TwilioError(
      'Twilio sender misconfigured: set either a phone number or a Messaging Service SID.',
      400,
    );
  }

  for (const url of input.mediaUrls || []) {
    form.append('MediaUrl', url);
  }
  if (input.statusCallback) {
    form.set('StatusCallback', input.statusCallback);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(input.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: buildBasicAuth(input.accountSid, input.authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TwilioError('Twilio request timed out', 0);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const payload = (await res.json().catch(() => null)) as
    | { sid?: string; status?: string; message?: string; code?: number }
    | null;

  if (!res.ok) {
    const message =
      (payload && typeof payload.message === 'string' && payload.message) ||
      `Twilio send failed (${res.status})`;
    throw new TwilioError(message, res.status, payload?.code, payload);
  }

  if (!payload?.sid) {
    throw new TwilioError('Twilio response missing message SID', res.status, undefined, payload);
  }

  return {
    messageSid: payload.sid,
    status: payload.status || 'queued',
  };
}

/**
 * Cheap, side-effect-free credential check. Hits Twilio's Account
 * resource — 200 means the SID + token combo is valid. Used by the
 * settings UI's "Verify Connection" button.
 */
export interface TwilioVerifyResult {
  ok: boolean;
  accountStatus?: string; // 'active' | 'suspended' | 'closed'
  friendlyName?: string;
  error?: string;
}

export async function verifyTwilioCredentials(
  accountSid: string,
  authToken: string,
): Promise<TwilioVerifyResult> {
  if (!accountSid.trim() || !authToken.trim()) {
    return { ok: false, error: 'Account SID and Auth Token are required.' };
  }
  if (!accountSid.startsWith('AC')) {
    return { ok: false, error: 'Twilio Account SIDs start with "AC".' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(accountSid)}.json`,
      {
        method: 'GET',
        headers: { Authorization: buildBasicAuth(accountSid, authToken) },
        signal: controller.signal,
      },
    );
    if (res.status === 200) {
      const payload = (await res.json().catch(() => ({}))) as {
        status?: string;
        friendly_name?: string;
      };
      return {
        ok: true,
        accountStatus: payload.status,
        friendlyName: payload.friendly_name,
      };
    }
    if (res.status === 401) {
      return { ok: false, error: 'Twilio rejected the credentials (401 Unauthorized).' };
    }
    return { ok: false, error: `Twilio returned HTTP ${res.status}.` };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Verification timed out.' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' };
  } finally {
    clearTimeout(timer);
  }
}
