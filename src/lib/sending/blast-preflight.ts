// Deliverability + compliance preflight for email blasts.
//
// WHY THIS EXISTS
// ───────────────
// A blast sent from a half-configured account doesn't fail loudly — it
// delivers straight to the spam folder, and it takes the sending domain's
// reputation down with it. That already happened once: a full blast from a
// sub-account with no SendGrid key of its own fell through to the shared
// SMTP transport, so it went out From the shared transactional address, with
// no List-Unsubscribe header and no physical address in the body. Every one
// of those is an independent spam signal, and the shared address means the
// damage lands on transactional mail (password resets, notifications) too.
//
// So the gate is deliberately a BLOCK, not a warning. The failure mode of
// blocking is "someone fills in a settings field"; the failure mode of
// warning is a burnt sending domain that takes weeks to recover.
//
// Split into blockers and warnings: blockers refuse the send, warnings are
// surfaced in the UI but let it through.

import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
  findUnknownMergetags,
} from '@/lib/sending/blast-mergetags';

export type PreflightSeverity = 'blocker' | 'warning';

export interface PreflightIssue {
  severity: PreflightSeverity;
  /** Stable identifier so the UI can deep-link to the right settings tab. */
  code: string;
  /** Sub-account this applies to; '' for campaign-wide issues. */
  accountKey: string;
  message: string;
  /** What the user should do about it. */
  remedy: string;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
}

/** Codes the Schedule step maps to a "Fix in settings" link. */
export const PREFLIGHT_CODES = {
  NO_SENDGRID_KEY: 'no_sendgrid_key',
  BAD_SENDGRID_KEY: 'bad_sendgrid_key',
  NO_SENDER_EMAIL: 'no_sender_email',
  SENDER_DOMAIN_MISMATCH: 'sender_domain_mismatch',
  NO_FROM_DOMAIN: 'no_from_domain',
  NO_PHYSICAL_ADDRESS: 'no_physical_address',
  UNKNOWN_MERGETAG: 'unknown_mergetag',
  NO_SUBJECT: 'no_subject',
  NO_BODY: 'no_body',
  NO_TEXT_PART: 'no_text_part',
} as const;

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase().trim();
}

/**
 * Is `sender` inside `authenticated`? Accepts an exact match or a subdomain
 * (mail.example.com is covered by example.com), which is how SendGrid's
 * domain authentication actually behaves.
 */
function domainCovers(authenticated: string, sender: string): boolean {
  const auth = authenticated.toLowerCase().trim().replace(/^\.+/, '');
  if (!auth || !sender) return false;
  return sender === auth || sender.endsWith(`.${auth}`);
}

export interface PreflightInput {
  subject: string;
  htmlContent: string;
  textContent?: string | null;
  /** Every sub-account this blast sends on behalf of. */
  accountKeys: string[];
}

/**
 * Check a blast for anything that would land it in spam or breach CAN-SPAM.
 *
 * Pure DB reads — no SendGrid API calls, so it's cheap enough to run on
 * every Schedule-step render as well as inside the send gate. Live domain
 * validation stays in the Sending settings tab's "Verify Connection", which
 * is where a user can act on it.
 */
export async function preflightEmailBlast(
  input: PreflightInput,
): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  // ── Content-level checks (account-independent) ──
  if (!input.subject.trim()) {
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.NO_SUBJECT,
      accountKey: '',
      message: 'This blast has no subject line.',
      remedy: 'Add a subject on the Message step.',
    });
  }
  if (!input.htmlContent.trim()) {
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.NO_BODY,
      accountKey: '',
      message: 'This blast has no message body.',
      remedy: 'Build or pick a template on the Message step.',
    });
  }

  const accountKeys = [...new Set(input.accountKeys.filter(Boolean))];

  const accounts = accountKeys.length > 0
    ? await prisma.account.findMany({
        where: { key: { in: accountKeys } },
        select: {
          key: true,
          dealer: true,
          senderEmail: true,
          sendgridApiKey: true,
          sendgridFromDomain: true,
          address: true,
          city: true,
          state: true,
          postalCode: true,
        },
      })
    : [];

  // Mergetag validation needs a context whose SHAPE matches send time. The
  // values are irrelevant — only which keys exist — so an empty contact is
  // exactly right, and it keeps preflight free of any contact query.
  const sampleCtx = buildBlastMergetagContext({
    contact: null,
    account: accounts[0]
      ? {
          dealer: accounts[0].dealer,
          senderEmail: accounts[0].senderEmail,
          address: accounts[0].address,
          city: accounts[0].city,
          state: accounts[0].state,
          postalCode: accounts[0].postalCode,
        }
      : null,
    unsubscribeToken: '#',
  });

  // Custom fields are per-contact, so preflight can't know them from the
  // account alone. Treat any custom_values.* token as valid rather than
  // blocking a send over a field this check simply can't see.
  const unknownTags = [
    ...findUnknownMergetags(input.subject, sampleCtx),
    ...findUnknownMergetags(input.htmlContent, sampleCtx),
  ].filter((tag) => !tag.startsWith('custom_values.'));

  if (unknownTags.length > 0) {
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.UNKNOWN_MERGETAG,
      accountKey: '',
      message: `Unrecognized merge tags would send as literal text: ${[
        ...new Set(unknownTags),
      ]
        .map((t) => `{{${t}}}`)
        .join(', ')}.`,
      remedy:
        'Fix the spelling on the Message step, or remove the tag. Check the variable picker for the supported list.',
    });
  }

  // ── Per-account sender identity + compliance ──
  const found = new Map(accounts.map((a) => [a.key, a]));
  for (const key of accountKeys) {
    const account = found.get(key);
    if (!account) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDER_EMAIL,
        accountKey: key,
        message: `Account "${key}" no longer exists.`,
        remedy: 'Reselect recipients on the Recipients step.',
      });
      continue;
    }

    const label = account.dealer || key;

    // 1. A per-account SendGrid key. Without one the send would fall back
    //    to the shared SMTP transport, which is the exact path that landed
    //    a blast in spam before. Blasts are no longer allowed on it.
    if (!account.sendgridApiKey) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDGRID_KEY,
        accountKey: key,
        message: `${label} has no SendGrid API key, so this blast has no compliant way to send.`,
        remedy: `Add a SendGrid API key under Settings → Sending for ${label}.`,
      });
    } else {
      // Ciphertext that won't decrypt is as good as absent — the worker
      // treats it as "no SendGrid", so catch it here instead of at send.
      try {
        decryptToken(account.sendgridApiKey);
      } catch {
        issues.push({
          severity: 'blocker',
          code: PREFLIGHT_CODES.BAD_SENDGRID_KEY,
          accountKey: key,
          message: `${label}'s stored SendGrid key can't be decrypted.`,
          remedy: `Re-enter the API key under Settings → Sending for ${label}.`,
        });
      }
    }

    // 2. A From address on a domain the account controls.
    const senderEmail = (account.senderEmail || '').trim();
    if (!senderEmail) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDER_EMAIL,
        accountKey: key,
        message: `${label} has no From address, so the blast would send from the shared Loomi address.`,
        remedy: `Set the From address under Settings → Sending for ${label}.`,
      });
    } else if (!account.sendgridFromDomain) {
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.NO_FROM_DOMAIN,
        accountKey: key,
        message: `${label} has no authenticated sending domain recorded, so SPF/DKIM alignment can't be confirmed.`,
        remedy: `Add the authenticated domain under Settings → Sending, then run Verify Connection.`,
      });
    } else if (!domainCovers(account.sendgridFromDomain, domainOf(senderEmail))) {
      // A From domain outside the authenticated one means the DKIM
      // signature won't align — a near-guaranteed spam placement.
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.SENDER_DOMAIN_MISMATCH,
        accountKey: key,
        message: `${label} sends from ${senderEmail} but only ${account.sendgridFromDomain} is authenticated — DKIM won't align.`,
        remedy: `Either send from an address on ${account.sendgridFromDomain}, or authenticate ${domainOf(senderEmail)} in SendGrid and record it under Settings → Sending.`,
      });
    }

    // 3. CAN-SPAM requires the sender's physical postal address in every
    //    commercial message. buildUnsubscribeFooter drops missing pieces
    //    silently, so without this check the footer just quietly ships
    //    non-compliant.
    const hasAddress = Boolean(
      (account.address || '').trim()
      && (account.city || '').trim()
      && (account.state || '').trim()
      && (account.postalCode || '').trim(),
    );
    if (!hasAddress) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_PHYSICAL_ADDRESS,
        accountKey: key,
        message: `${label} has no complete mailing address, which CAN-SPAM requires in the footer of every commercial email.`,
        remedy: `Add street, city, state, and ZIP under Settings → Sending for ${label}.`,
      });
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'blocker'),
    issues,
  };
}

/**
 * One-line summary of the blockers, for an API error body or a toast.
 */
export function formatPreflightBlockers(result: PreflightResult): string {
  const blockers = result.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length === 0) return '';
  return blockers.map((b) => `${b.message} ${b.remedy}`).join(' ');
}

/**
 * Guard for the text/plain part. A blast with an HTML body but no plaintext
 * alternative scores worse with every major spam filter. The worker derives
 * one from the HTML when none is stored, so this is a warning, not a block —
 * a hand-written version is simply better than a stripped one.
 */
export function checkTextPart(
  htmlContent: string,
  textContent: string | null | undefined,
): PreflightIssue | null {
  if ((textContent || '').trim()) return null;
  if (!htmlContent.trim()) return null;
  return {
    severity: 'warning',
    code: PREFLIGHT_CODES.NO_TEXT_PART,
    accountKey: '',
    message: 'No plain-text version is stored; one will be auto-generated from the HTML.',
    remedy: 'Optional: write a plain-text version on the Message step for a better spam score.',
  };
}

/** Re-exported so callers can render a preview through the same code path. */
export { applyBlastMergetags };
