/**
 * The account "Industry" list — a single, editable source of truth.
 *
 * Historically the dropdown options were a hardcoded `CATEGORY_SUGGESTIONS`
 * array copied into four components (and one copy had drifted out of sync).
 * This service makes the list DB-backed (one AppSetting row holding a JSON
 * array) so it can be managed at runtime from the Industries settings tab,
 * while still falling back to DEFAULT_INDUSTRIES when nothing's been saved.
 */
import { getSetting, setSetting } from '@/lib/services/app-settings';
import { DEFAULT_INDUSTRIES } from '@/data/industry-defaults';

export const INDUSTRIES_SETTING_KEY = 'app-industries';

/**
 * Normalize arbitrary input into a clean industry list: strings only, trimmed,
 * empties dropped, deduped case-insensitively (first spelling wins). Order is
 * preserved — it drives the dropdown order.
 */
export function normalizeIndustries(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** The effective industry list — the saved one, or DEFAULT_INDUSTRIES. */
export async function getIndustries(): Promise<string[]> {
  const raw = await getSetting(INDUSTRIES_SETTING_KEY);
  if (!raw) return [...DEFAULT_INDUSTRIES];
  try {
    const parsed = normalizeIndustries(JSON.parse(raw));
    return parsed.length ? parsed : [...DEFAULT_INDUSTRIES];
  } catch {
    // Corrupt value — don't break every dropdown; fall back to defaults.
    return [...DEFAULT_INDUSTRIES];
  }
}

/**
 * Replace the industry list. Normalizes and refuses an empty result (an empty
 * list would blank every account "Industry" dropdown). Returns the saved list.
 */
export async function setIndustries(input: unknown): Promise<string[]> {
  const list = normalizeIndustries(input);
  if (list.length === 0) {
    throw new Error('At least one industry is required.');
  }
  await setSetting(INDUSTRIES_SETTING_KEY, JSON.stringify(list));
  return list;
}
