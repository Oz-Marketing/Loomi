import { getSetting, setSetting } from '@/lib/services/app-settings';

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
