/**
 * Undeliverable email domains — the ones no amount of retrying will fix.
 *
 * Derived from a production survey, not invented: 850 of ~272,000 contact
 * addresses sat on 92 domains that cannot receive mail. They bounced on every
 * send, and a bounce is charged to the SENDING domain's reputation, so a
 * handful of placeholder rows quietly taxes every campaign.
 *
 * ── WHY THIS REJECTS RATHER THAN CORRECTS ───────────────────────────────────
 * `gmial.com` is obviously a typo for `gmail.com`, and `cydsi,ank@yahoo.com`
 * is obviously a mistyped comma. Correcting either means GUESSING a real
 * person's address — `cydsiank@` and `cydsi.ank@` are equally plausible and one
 * of them may belong to someone else. So these are rejected, never rewritten.
 * A human editing the contact record is the only correct fix.
 *
 * ── THE ALLOWLIST IS LOAD-BEARING ───────────────────────────────────────────
 * An early version of the survey used a loose pattern for "looks like gmail"
 * and matched `gmail.com` itself — all 149,265 of them. Nothing here may be a
 * fuzzy match: every rule is an exact-set membership or a last-label check, and
 * REAL_DOMAINS short-circuits before any of them run.
 */

/**
 * Domains that are real and must never be flagged, however close a typo looks.
 * Checked FIRST, so no rule below can reach them.
 */
const REAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'msn.com', 'live.com', 'comcast.net', 'att.net',
  'sbcglobal.net', 'verizon.net', 'cox.net', 'mac.com', 'mail.com',
  'ymail.com', 'protonmail.com', 'proton.me', 'gmx.com', 'email.com',
  'yahoo.ca', 'hotmail.ca', 'outlook.es', 'yahoo.es', 'yahoo.co.uk',
  'hotmail.co.uk', 'googlemail.com', 'bellsouth.net', 'charter.net',
  'earthlink.net', 'juno.com', 'netzero.net', 'roadrunner.com', 'rocketmail.com',
]);

/** Throwaway inbox providers — a send here is wasted even when it lands. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'trashmail.com', 'yopmail.com', 'sharklasers.com', 'temp-mail.org',
  'throwawaymail.com', 'maildrop.cc',
]);

/**
 * Last labels that are not TLDs anyone owns — overwhelmingly mistyped `.com`
 * (`.con`, `.cpm`, `.vom` are all one key away on a QWERTY keyboard).
 *
 * `.co` is deliberately ABSENT: it is Colombia's real TLD and a common startup
 * domain. Free-provider `.co` typos are caught by name in PROVIDER_TYPOS
 * instead, where the pairing with a known provider makes it unambiguous.
 */
const INVALID_TLDS = new Set([
  'om', 'cm', 'con', 'comm', 'cpm', 'vom', 'xom', 'coom', 'c0m', 'ocm',
  'come', 'comk', 'nte', 'ner', 'nef', 'orgg', 'ccom', 'cim', 'cok', 'clm',
]);

/**
 * Placeholder domains staff and CRM feeds type when there is no address.
 * Matched on the FIRST label so `none.com`, `none.cm` and `noemail.v` are all
 * caught without needing every spelling enumerated.
 */
const PLACEHOLDER_FIRST_LABEL = new Set([
  'none', 'noemail', 'no-email', 'nomail', 'na', 'test', 'example', 'invalid',
  'unknown', 'null', 'xxx', 'abc', 'asdf', 'nothing', 'dummy', 'fake',
  'placeholder', 'nofound',
]);
// Deliberately NOT here: 'email' and 'noreply'. Both are ordinary words that
// begin real domains (email.net, noreply.io), and 'noreply' is a local part
// rather than a domain in every case we have actually seen. 'example' stays —
// example.com/net/org are reserved by RFC 2606 and can never receive mail.

/**
 * Misspellings of the big free providers. Exact matches only — a fuzzy rule
 * here is what nearly suppressed the entire gmail.com roster.
 */
const PROVIDER_TYPOS = new Set([
  // gmail
  'gmial.com', 'gamil.com', 'gmai.com', 'gmal.com', 'gmil.com', 'gnail.com',
  'gma.com', 'gmaill.com', 'gmail.co', 'gmali.com', 'gmail.om', 'gmial.co',
  // yahoo
  'yaho.com', 'yahooo.com', 'yahou.com', 'yhaoo.com', 'yahoo.co', 'yahoo.om',
  // hotmail
  'hotmial.com', 'hotmai.com', 'hotmaill.com', 'hotmail.co', 'hotmal.com',
  // others
  'outlok.com', 'outllok.com', 'outlook.co', 'iclould.com', 'icloud.co',
  'iclod.com', 'aol.co', 'comcast.com', 'msn.co',
]);

export type EmailRejection =
  | 'syntax'
  | 'unparseable'
  | 'placeholder'
  | 'invalid-tld'
  | 'provider-typo'
  | 'disposable';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/**
 * Why this address cannot be delivered to, or null when it looks fine.
 *
 * Returns the REASON rather than a boolean so callers can log, suppress and
 * report on categories — "550 typo'd domains" is actionable in a way that
 * "550 invalid" is not.
 */
export function classifyEmail(value: string | null | undefined): EmailRejection | null {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return 'syntax';

  // A value still holding a delimiter is several addresses (or a mistyped
  // one), never a single deliverable address.
  if (/[;,]/.test(email)) return 'unparseable';
  if (!EMAIL_REGEX.test(email)) return 'syntax';

  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return 'syntax';
  const domain = email.slice(at + 1);

  // Real domains win over every rule below.
  if (REAL_DOMAINS.has(domain)) return null;

  const labels = domain.split('.');
  if (PLACEHOLDER_FIRST_LABEL.has(labels[0]!)) return 'placeholder';
  if (INVALID_TLDS.has(labels[labels.length - 1]!)) return 'invalid-tld';
  if (PROVIDER_TYPOS.has(domain)) return 'provider-typo';
  if (DISPOSABLE_DOMAINS.has(domain)) return 'disposable';

  return null;
}

/** Human-readable reason, for suppression records and operator-facing copy. */
export function describeRejection(reason: EmailRejection): string {
  switch (reason) {
    case 'syntax':
      return 'Not a valid email address';
    case 'unparseable':
      return 'Holds more than one address, or a stray comma or semicolon';
    case 'placeholder':
      return 'Placeholder domain — no mailbox exists';
    case 'invalid-tld':
      return 'Domain ends in a TLD that does not exist (usually a mistyped .com)';
    case 'provider-typo':
      return 'Misspelled email provider domain';
    case 'disposable':
      return 'Disposable inbox provider';
  }
}
