import { classifyEmail } from '@/lib/sending/email-domains';

export function normalizeEmailAddress(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Can this address plausibly receive mail?
 *
 * Delegates to {@link classifyEmail}, which is the single place undeliverable
 * domains are defined. It used to check syntax plus a six-entry disposable
 * list, which let 850 production contacts on placeholder and mistyped domains
 * through to be sent to — and every one of those bounces is charged to the
 * sending domain's reputation.
 */
export function isLikelyDeliverableEmail(value: string | null | undefined): boolean {
  return classifyEmail(normalizeEmailAddress(value)) === null;
}

export function normalizePhoneNumber(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const hasPlus = raw.startsWith('+');
  const digitsOnly = raw.replace(/\D+/g, '');
  if (!digitsOnly) return '';

  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

export function isLikelyDialablePhone(value: string | null | undefined): boolean {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return false;

  const digits = normalized.startsWith('+')
    ? normalized.slice(1)
    : normalized;

  return digits.length >= 10 && digits.length <= 15;
}
