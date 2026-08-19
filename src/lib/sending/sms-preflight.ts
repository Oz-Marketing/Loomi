// Compliance + deliverability preflight for SMS blasts.
//
// The email equivalent (blast-preflight.ts) exists because a misconfigured
// blast lands in spam. The SMS stakes are different in kind, not just degree:
// TCPA damages are statutory, per message, and start at $500 — so a 5,000
// recipient blast sent an hour too early is six figures of exposure with no
// technical symptom at all. Nothing else in this pipeline can cost that much.
//
// Same shape as the email gate: blockers refuse the send, warnings inform it.

import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import {
  buildBlastMergetagContext,
  findUnknownMergetags,
} from '@/lib/sending/blast-mergetags';
import {
  assessQuietHours,
  QUIET_HOURS_END_HOUR,
  QUIET_HOURS_START_HOUR,
  zoneLabel,
} from '@/lib/sending/sms-quiet-hours';

export type SmsPreflightSeverity = 'blocker' | 'warning';

export interface SmsPreflightIssue {
  severity: SmsPreflightSeverity;
  code: string;
  accountKey: string;
  message: string;
  remedy: string;
}

export interface SmsPreflightResult {
  ok: boolean;
  issues: SmsPreflightIssue[];
  /**
   * Earliest instant a quiet-hours-held recipient could be texted, when the
   * send time is non-compliant. The Schedule step offers this as a one-click
   * "send at 8am local instead".
   */
  suggestedSendAt: string | null;
  /** Recipients that would be held if the send went ahead as timed. */
  heldByQuietHours: number;
}

export const SMS_PREFLIGHT_CODES = {
  NO_TWILIO: 'no_twilio',
  BAD_TWILIO: 'bad_twilio',
  NO_SENDER: 'no_sender',
  NO_MESSAGING_SERVICE: 'no_messaging_service',
  NO_MESSAGE: 'no_message',
  NO_OPT_OUT: 'no_opt_out',
  UNKNOWN_MERGETAG: 'unknown_mergetag',
  QUIET_HOURS: 'quiet_hours',
  UNKNOWN_TIMEZONE: 'unknown_timezone',
  NO_STATUS_CALLBACK: 'no_status_callback',
  MANY_SEGMENTS: 'many_segments',
} as const;

/**
 * Phrases that satisfy a carrier opt-out disclosure.
 *
 * Matched loosely on purpose — "Reply STOP to opt out", "txt STOP to cancel"
 * and "Reply STOP 2 end" all satisfy the rule, and rejecting a valid variant
 * would train people to work around the check rather than comply with it.
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bstop\b/i,
  /\bopt[\s-]?out\b/i,
  /\bunsubscribe\b/i,
];

/** Does the body disclose how to opt out? */
export function hasOptOutLanguage(message: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Segment count for a body, matching the composer's own math so preflight and
 * the character counter never disagree. GSM-7 fits 160, Unicode 70.
 */
export function segmentCount(message: string): number {
  const length = message.length;
  if (length === 0) return 0;
  const perSegment = /[^\x00-\x7F]/.test(message) ? 70 : 160;
  return Math.ceil(length / perSegment);
}

export interface SmsPreflightInput {
  message: string;
  accountKeys: string[];
  /** Phones the blast would text — required for the quiet-hours assessment. */
  recipients: { phone: string | null | undefined }[];
  /** Intended send instant. Defaults to now (an immediate send). */
  sendAt?: Date | null;
  /**
   * When true, a quiet-hours violation is a WARNING instead of a blocker: the
   * caller has accepted that held recipients go out as their own local windows
   * open. Set by the Schedule step's "send at 8am local" option.
   */
  deferOutsideQuietHours?: boolean;
}

export async function preflightSmsBlast(
  input: SmsPreflightInput,
): Promise<SmsPreflightResult> {
  const issues: SmsPreflightIssue[] = [];
  const message = input.message || '';
  const sendAt = input.sendAt ?? new Date();

  // ── Content ──
  if (!message.trim()) {
    issues.push({
      severity: 'blocker',
      code: SMS_PREFLIGHT_CODES.NO_MESSAGE,
      accountKey: '',
      message: 'This blast has no message.',
      remedy: 'Write one on the Message step.',
    });
  }

  // Carrier rules (CTIA) require every marketing campaign to disclose its
  // opt-out. Absent it, carriers filter or block the sending number outright —
  // which takes down the rooftop's texting entirely, not just this blast.
  if (message.trim() && !hasOptOutLanguage(message)) {
    issues.push({
      severity: 'blocker',
      code: SMS_PREFLIGHT_CODES.NO_OPT_OUT,
      accountKey: '',
      message: 'The message never tells recipients how to opt out.',
      remedy:
        'Add "Reply STOP to opt out" (or equivalent). If your Twilio Messaging Service appends it automatically via Advanced Opt-Out, add the wording here anyway so the sent copy matches what was reviewed.',
    });
  }

  const accountKeys = [...new Set(input.accountKeys.filter(Boolean))];

  const accounts = accountKeys.length > 0
    ? await prisma.account.findMany({
        where: { key: { in: accountKeys } },
        select: {
          key: true,
          dealer: true,
          timezone: true,
          twilioAccountSid: true,
          twilioAuthToken: true,
          twilioPhoneNumber: true,
          twilioMessagingServiceSid: true,
        },
      })
    : [];

  // Mergetag validation: only the SHAPE of the context matters, so an empty
  // contact is correct and keeps this free of any contact query.
  const sampleCtx = buildBlastMergetagContext({
    contact: null,
    account: accounts[0] ? { dealer: accounts[0].dealer } : null,
    // SMS opts out by replying STOP, so there is no unsubscribe URL to bind.
    unsubscribeToken: '',
  });
  const unknownTags = findUnknownMergetags(message, sampleCtx)
    // Custom fields are per-contact; preflight can't see them from the account.
    .filter((tag) => !tag.startsWith('custom_values.'))
    // {{unsubscribe_link}} is meaningless in SMS — call that out specifically
    // below rather than lumping it in with typos.
    .filter((tag) => tag !== 'unsubscribe_link');

  if (unknownTags.length > 0) {
    issues.push({
      severity: 'blocker',
      code: SMS_PREFLIGHT_CODES.UNKNOWN_MERGETAG,
      accountKey: '',
      message: `Unrecognized merge tags would send as literal text: ${[
        ...new Set(unknownTags),
      ].map((t) => `{{${t}}}`).join(', ')}.`,
      remedy: 'Fix the spelling on the Message step, or remove the tag.',
    });
  }
  if (/\{\{\s*unsubscribe_link\s*\}\}/.test(message)) {
    issues.push({
      severity: 'blocker',
      code: SMS_PREFLIGHT_CODES.UNKNOWN_MERGETAG,
      accountKey: '',
      message: '{{unsubscribe_link}} does not work in SMS — there is no hosted unsubscribe page.',
      remedy: 'Replace it with "Reply STOP to opt out".',
    });
  }

  const segments = segmentCount(message);
  if (segments > 3) {
    issues.push({
      severity: 'warning',
      code: SMS_PREFLIGHT_CODES.MANY_SEGMENTS,
      accountKey: '',
      message: `This message is ${segments} segments, so each recipient is billed ${segments} times.`,
      remedy: 'Shorten it below 160 characters (or 70 if it contains emoji) to send as one.',
    });
  }

  // ── Per-account transport ──
  const found = new Map(accounts.map((a) => [a.key, a]));
  for (const key of accountKeys) {
    const account = found.get(key);
    if (!account) {
      issues.push({
        severity: 'blocker',
        code: SMS_PREFLIGHT_CODES.NO_TWILIO,
        accountKey: key,
        message: `Account "${key}" no longer exists.`,
        remedy: 'Reselect recipients on the Recipients step.',
      });
      continue;
    }

    const label = account.dealer || key;

    if (!account.twilioAccountSid || !account.twilioAuthToken) {
      issues.push({
        severity: 'blocker',
        code: SMS_PREFLIGHT_CODES.NO_TWILIO,
        accountKey: key,
        message: `${label} has no Twilio credentials, so it cannot send SMS at all.`,
        remedy: `Add the Account SID and Auth Token under Messaging Settings → SMS for ${label}.`,
      });
    } else {
      try {
        decryptToken(account.twilioAccountSid);
        decryptToken(account.twilioAuthToken);
      } catch {
        issues.push({
          severity: 'blocker',
          code: SMS_PREFLIGHT_CODES.BAD_TWILIO,
          accountKey: key,
          message: `${label}'s stored Twilio credentials can't be decrypted.`,
          remedy: `Re-enter them under Messaging Settings → SMS for ${label}.`,
        });
      }
    }

    if (!account.twilioPhoneNumber && !account.twilioMessagingServiceSid) {
      issues.push({
        severity: 'blocker',
        code: SMS_PREFLIGHT_CODES.NO_SENDER,
        accountKey: key,
        message: `${label} has no sending number or Messaging Service.`,
        remedy: `Set a phone number or Messaging Service SID under Messaging Settings → SMS for ${label}.`,
      });
    } else if (!account.twilioMessagingServiceSid) {
      // A2P 10DLC registration attaches to a Messaging Service, not to a bare
      // number. Sending US A2P traffic from an unregistered long code gets
      // heavily filtered and can be blocked outright — but plenty of legitimate
      // setups (toll-free, short code) don't use one, so this informs.
      issues.push({
        severity: 'warning',
        code: SMS_PREFLIGHT_CODES.NO_MESSAGING_SERVICE,
        accountKey: key,
        message: `${label} sends from a bare phone number with no Messaging Service, so A2P 10DLC registration can't be confirmed.`,
        remedy:
          'Unregistered 10DLC traffic is filtered by US carriers. Attach the number to a registered Messaging Service in Twilio and record its SID.',
      });
    }
  }

  // Delivery receipts ride on a public callback URL. With none configured the
  // send still works, but nothing ever reports back — so `sent` never becomes
  // `delivered` and dead numbers are never auto-suppressed. It fails silently,
  // which is why it's worth saying out loud.
  if (!process.env.APP_PUBLIC_URL && !process.env.NEXTAUTH_URL) {
    issues.push({
      severity: 'warning',
      code: SMS_PREFLIGHT_CODES.NO_STATUS_CALLBACK,
      accountKey: '',
      message: 'No public URL is configured, so Twilio cannot report delivery results back.',
      remedy:
        'Set APP_PUBLIC_URL. Without it, delivery and failure tracking is lost and undeliverable numbers are never suppressed.',
    });
  }

  // ── TCPA quiet hours ──
  const accountTimezone = accounts.length === 1 ? accounts[0].timezone : null;
  const quiet = assessQuietHours(input.recipients, sendAt, accountTimezone);

  let suggestedSendAt: string | null = null;
  if (quiet.held > 0) {
    suggestedSendAt = quiet.earliestResume?.toISOString() ?? null;
    const zoneList = quiet.zonesRepresented.map(zoneLabel).join(', ');
    issues.push({
      severity: input.deferOutsideQuietHours ? 'warning' : 'blocker',
      code: SMS_PREFLIGHT_CODES.QUIET_HOURS,
      accountKey: '',
      message: input.deferOutsideQuietHours
        ? `${quiet.held.toLocaleString()} of ${input.recipients.length.toLocaleString()} recipients are in a quiet period and will be held until ${QUIET_HOURS_START_HOUR}am their local time.`
        : `${quiet.held.toLocaleString()} of ${input.recipients.length.toLocaleString()} recipients would be texted outside ${QUIET_HOURS_START_HOUR}am–${QUIET_HOURS_END_HOUR - 12}pm local time, which the TCPA prohibits (${zoneList}).`,
      remedy: input.deferOutsideQuietHours
        ? 'Each recipient sends as their own local window opens; the blast stays in progress until then.'
        : 'Choose "Send at 8am local time instead", or pick a send time inside the window for every timezone on the list.',
    });
  }

  // Not a blocker — see isWithinQuietHours for why an unknown zone is allowed
  // through — but the operator should know the check couldn't cover everyone.
  if (quiet.unknownZone > 0) {
    issues.push({
      severity: 'warning',
      code: SMS_PREFLIGHT_CODES.UNKNOWN_TIMEZONE,
      accountKey: '',
      message: `${quiet.unknownZone.toLocaleString()} recipient(s) have a phone number whose timezone can't be determined, so quiet hours couldn't be checked for them.`,
      remedy:
        'Usually a non-US number or a new area code. Set the rooftop\'s timezone under Settings → General so these fall back to it.',
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'blocker'),
    issues,
    suggestedSendAt,
    heldByQuietHours: quiet.held,
  };
}

/** One-line summary of the blockers, for an API error body or a toast. */
export function formatSmsPreflightBlockers(result: SmsPreflightResult): string {
  const blockers = result.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length === 0) return '';
  return blockers.map((b) => `${b.message} ${b.remedy}`).join(' ');
}
