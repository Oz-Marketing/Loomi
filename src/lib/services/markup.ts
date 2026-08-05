import { getSetting, setSetting } from '@/lib/services/app-settings';
import { BILLING_CATEGORIES, isBillingCategory } from '@/lib/budget/channels';

/**
 * Agency-wide default markup (gross→spend factor), editable by elevated admins
 * in Settings → Markup. Backed by one AppSetting row (see services/app-settings
 * — DB-backed so it survives deploys). Per-account overrides (Account.markup)
 * take precedence; see `accountMarginSetting` in the pacer's _lib/markup.
 *
 * The intrinsic default is 0 (unconfigured), NOT a hardcoded business value:
 * an unset default surfaces as an obviously-broken $0 target rather than a
 * silently-wrong plausible number (spec §0.1). The value is seeded to 0.77 on
 * rollout so live accounts keep computing correctly the moment this ships.
 */
export const DEFAULT_MARKUP_SETTING_KEY = 'app-default-markup';

/**
 * The configured agency-wide default markup factor, or 0 when unconfigured /
 * corrupt. Read once per request and passed into `accountMarginSetting`.
 */
export async function getGlobalDefaultMarkup(): Promise<number> {
  const raw = await getSetting(DEFAULT_MARKUP_SETTING_KEY);
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Set the agency-wide default markup factor. Rejects non-positive / NaN — a
 * 0 default would zero every unoverridden account's target, so it can only
 * become 0 by being unset, never by an explicit save.
 */
export async function setGlobalDefaultMarkup(value: number): Promise<number> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Default markup must be a positive number (e.g. 0.77).');
  }
  await setSetting(DEFAULT_MARKUP_SETTING_KEY, String(value));
  return value;
}

// ── Rate cards ──────────────────────────────────────────────────────────────
//
// One markup per billing category (Digital, Mass Media, Swag…). Before this
// there was a single agency-wide number and it was Digital's — every radio buy,
// swag order and print run computed at a 23% margin because that was the only
// rate the system had.
//
// Stored one AppSetting row per category rather than as a JSON blob, so a bad
// write can only ever corrupt one rate, and so the audit trail reads as
// "someone changed Swag" instead of "someone changed the markup config".

/** Setting key for one category's rate. Namespaced under the global one. */
export function billingMarkupKey(category: string): string {
  return `app-markup-billing-${category}`;
}

/**
 * Every configured rate card, keyed by billing category.
 *
 * A category with no stored row falls back to the seed in `BILLING_CATEGORIES`
 * — so the rates work on day one without anyone visiting Settings, and the
 * page shows real numbers rather than a form full of blanks. A stored row that
 * is corrupt or non-positive is treated as absent for the same reason the
 * global default is: a plausible-looking wrong number is worse than the seed.
 */
export async function getBillingMarkups(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    BILLING_CATEGORIES.map(async (c) => {
      const raw = await getSetting(billingMarkupKey(c.key));
      const n = raw == null ? NaN : Number(raw);
      return [c.key, Number.isFinite(n) && n > 0 ? n : c.defaultMarkup] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Set one category's rate. Same positive-number guard as the global default. */
export async function setBillingMarkup(category: string, value: number): Promise<number> {
  if (!isBillingCategory(category)) {
    throw new Error(`"${category}" is not a billing category.`);
  }
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error('A markup must be between 0 and 1 (e.g. 0.77 for a 23% margin).');
  }
  await setSetting(billingMarkupKey(category), String(value));
  return value;
}
