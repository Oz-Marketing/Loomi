/**
 * Reporting margin markup — parity port of Oz Dealer Tools' `applyMargins()`.
 *
 * Media cost is billed to clients with the agency margin baked in. Given a
 * per-account margin percent `m`, a cost field `c` is grossed up as:
 *
 *     billed = c / (1 - m/100)
 *
 * and the raw platform value is preserved alongside it as `actual_<field>`.
 * This is how every dollar figure in the ad reports is computed, so the
 * formula must match the PHP byte-for-byte (see margins.test.ts, which asserts
 * numeric parity against the original output).
 *
 * Rules carried over verbatim from the PHP:
 *   - margin <= 0 (or NaN) → return the data untouched, no `actual_*` keys.
 *   - only fields that are present AND > 0 are marked up; a missing or
 *     zero/negative field is left alone (so device/daily rows, which only
 *     carry `spend`, naturally mark up just that one field).
 *
 * The three ad platforms mark up different field sets, so the field list is a
 * parameter; the exported wrappers pin the per-platform sets.
 *   - Meta / StackAdapt: spend, cpc, cpm, cost_per_conversion
 *   - Google:            cost,  avg_cpc, cost_per_conversion
 */

/** Cost fields Meta (and StackAdapt) mark up. */
export const META_MARGIN_FIELDS = [
  'spend',
  'cpc',
  'cpm',
  'cost_per_conversion',
] as const;

/** StackAdapt marks up the same cost fields as Meta. */
export const STACKADAPT_MARGIN_FIELDS = META_MARGIN_FIELDS;

/** Cost fields Google Ads marks up. (Google reports `cost` / `avg_cpc`.) */
export const GOOGLE_MARGIN_FIELDS = [
  'cost',
  'avg_cpc',
  'cost_per_conversion',
] as const;

/**
 * Return a copy of `data` with each named cost field grossed up by `margin`
 * (a percent), preserving the raw value as `actual_<field>`. Non-mutating.
 */
export function applyMargins<T extends object>(
  data: T,
  marginPercent: number,
  fields: readonly string[],
): T & Record<string, number> {
  // Mirror PHP `if ($marginPercent <= 0) return $data;` — also catches NaN.
  // Also guard the upper bound the PHP never did: margin == 100 divides by zero
  // (→ Infinity, which serializes to JSON null), and margin > 100 flips the sign
  // (→ negative billed cost). A margin in [100, ∞) is a config error, so fall
  // back to face value (no markup) rather than emit garbage into the report.
  if (!(marginPercent > 0) || marginPercent >= 100) return data as T & Record<string, number>;

  const d = marginPercent / 100;
  const out = { ...data } as Record<string, unknown>;

  for (const field of fields) {
    const value = out[field];
    if (typeof value === 'number' && value > 0) {
      out[`actual_${field}`] = value;
      out[field] = value / (1 - d);
    }
  }

  return out as T & Record<string, number>;
}

/** Meta / Facebook Ads margin markup (spend, cpc, cpm, cost_per_conversion). */
export function applyMetaMargins<T extends object>(
  data: T,
  marginPercent: number,
): T & Record<string, number> {
  return applyMargins(data, marginPercent, META_MARGIN_FIELDS);
}

/** StackAdapt margin markup (same cost fields as Meta). */
export function applyStackAdaptMargins<T extends object>(
  data: T,
  marginPercent: number,
): T & Record<string, number> {
  return applyMargins(data, marginPercent, STACKADAPT_MARGIN_FIELDS);
}

/** Google Ads margin markup (cost, avg_cpc, cost_per_conversion). */
export function applyGoogleMargins<T extends object>(
  data: T,
  marginPercent: number,
): T & Record<string, number> {
  return applyMargins(data, marginPercent, GOOGLE_MARGIN_FIELDS);
}
