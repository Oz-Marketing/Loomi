/**
 * Helpers for the multi-address CRM lead-intake list.
 *
 * `CrmDestination.leadEmails` is stored as a JSON array of email strings. These
 * helpers parse it (tolerating a legacy single value / comma- or newline-
 * separated string), and normalize arbitrary API input into a deduped list of
 * valid addresses so callers can reject bad input.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a syntactically valid email address. */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Parse stored leadEmails into a string[]. Tolerant of legacy formats. */
export function parseLeadEmails(stored: string | null | undefined): string[] {
  if (!stored) return [];
  const s = stored.trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map((x) => x.trim());
      }
    } catch {
      // fall through to delimiter parsing
    }
  }
  // Legacy: a single address, or a comma/semicolon/newline-separated string.
  return s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Normalize arbitrary input (string[] or a delimited string) into a deduped
 * (case-insensitive) list of valid emails, surfacing any invalid entries.
 */
export function normalizeLeadEmails(input: unknown): { emails: string[]; invalid: string[] } {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,;]+/)
      : [];

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t) continue;
    if (!isValidEmail(t)) {
      invalid.push(t);
      continue;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(t);
  }
  return { emails, invalid };
}

/** Serialize a list of emails for storage. */
export function stringifyLeadEmails(emails: string[]): string {
  return JSON.stringify(emails);
}
