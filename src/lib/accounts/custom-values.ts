import { normalizeMergeKey } from '@/lib/sending/account-merge-values';

/**
 * Account custom values — the `{{custom_values.*}}` merge tags an account
 * fills in for itself (links, review URLs, anything a template should say per
 * store) — and copying them from a group down to its accounts.
 *
 * Stored on `Account.customValues` as `{ [key]: { name, value } }`. The key is
 * what templates reference, so it's fixed when a value is created; renaming
 * changes only the label.
 *
 * Pure and client-safe.
 */

export interface CustomValueDef {
  name: string;
  value: string;
}

export type CustomValueMap = Record<string, CustomValueDef>;

/** Stored in the same map but edited elsewhere (General → storefront image). */
export const HIDDEN_CUSTOM_VALUE_KEYS = new Set(['storefront_image']);

/** "Specials URL" → "specials_url". The merge-tag key a new value gets. */
export function customValueKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** `{ name, value }` from whatever is stored — older rows hold bare strings. */
export function parseCustomValues(raw: unknown): CustomValueMap {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: CustomValueMap = {};
  for (const [key, def] of Object.entries(obj as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (typeof def === 'string') out[key] = { name: key, value: def };
    else if (def && typeof def === 'object') {
      const d = def as Record<string, unknown>;
      out[key] = { name: typeof d.name === 'string' && d.name.trim() ? d.name : key, value: typeof d.value === 'string' ? d.value : '' };
    }
  }
  return out;
}

/** The key already in `map` that means the same tag as `key`, if any. */
function sameKeyIn(map: CustomValueMap, key: string): string | undefined {
  const norm = normalizeMergeKey(key);
  return Object.keys(map).find((k) => normalizeMergeKey(k) === norm);
}

/** Problems with a set of edited values, by key, in words for the person editing. */
export function customValueProblems(map: CustomValueMap): Record<string, string> {
  const problems: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const [key, def] of Object.entries(map)) {
    if (!normalizeMergeKey(key)) problems[key] = 'Give it a name.';
    else if (!def.name.trim()) problems[key] = 'Give it a name.';
    const norm = normalizeMergeKey(key);
    const first = seen.get(norm);
    if (first !== undefined && norm) problems[key] = `Same tag as "${map[first].name}".`;
    else seen.set(norm, key);
  }
  return problems;
}

export interface CopyOptions {
  /** Replace a value the account already has. Off: the account's own value stays. */
  overwrite: boolean;
  /** Copy the group's values. Off: names only, values left blank to fill in per account. */
  withValues: boolean;
}

export interface CopyResult {
  next: CustomValueMap;
  added: string[];
  replaced: string[];
  /** Already on the account and left alone. */
  kept: string[];
}

/**
 * Copy `keys` from `source` into `target`. Matched by tag, so an account that
 * already has "Specials URL" isn't given a second `specials_url`; the
 * account's own key spelling is kept, so its templates keep working.
 */
export function copyCustomValues(
  target: CustomValueMap,
  source: CustomValueMap,
  keys: string[],
  opts: CopyOptions,
): CopyResult {
  const next: CustomValueMap = { ...target };
  const result: CopyResult = { next, added: [], replaced: [], kept: [] };
  for (const key of keys) {
    const def = source[key];
    if (!def || HIDDEN_CUSTOM_VALUE_KEYS.has(key)) continue;
    const value = opts.withValues ? def.value : '';
    const existing = sameKeyIn(next, key);
    if (!existing) {
      next[key] = { name: def.name, value };
      result.added.push(key);
    } else if (opts.overwrite && opts.withValues && next[existing].value !== value) {
      next[existing] = { name: next[existing].name, value };
      result.replaced.push(existing);
    } else {
      result.kept.push(existing);
    }
  }
  return result;
}
