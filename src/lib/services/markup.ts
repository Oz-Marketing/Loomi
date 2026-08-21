import { getSetting, setSetting } from '@/lib/services/app-settings';
import { activeRates, setRateByKey } from '@/lib/services/rate-cards';

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
// The rates now live in the `BillingCategory` TABLE, not in the
// `app-markup-billing-<key>` AppSetting rows this used to read, because the
// category LIST has to be editable too — see services/rate-cards.ts. The
// functions below stay as the markup-resolution contract (`resolveMarkup` in
// services/budget imports `getBillingMarkups`) and simply delegate.

/**
 * Setting key for one category's rate, in the pre-table layout.
 *
 * Kept only so the seed script can migrate the rates that are already live
 * there. Nothing reads these rows at runtime any more.
 */
export function billingMarkupKey(category: string): string {
  return `app-markup-billing-${category}`;
}

/**
 * Every active rate card, keyed by billing category.
 *
 * An archived (or deleted) category is ABSENT rather than zero, so the caller's
 * precedence chain falls through to the account rate and then the agency
 * default — the behaviour that existed before rate cards, which is the right
 * answer for a category someone deliberately retired.
 */
export async function getBillingMarkups(): Promise<Record<string, number>> {
  return activeRates();
}

/** Set one category's rate. The category must already exist. */
export async function setBillingMarkup(category: string, value: number): Promise<number> {
  return setRateByKey(category, value);
}
