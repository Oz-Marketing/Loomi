import type { AdData } from './types';

/**
 * The account's logo variants, and how a template pins one.
 *
 * A sub-account's branding holds up to four logo files. An element bound to
 * "Account logo" used to resolve to exactly one of them — `light` — so a design
 * with a dark panel had no way to ask for the logo that reads on it. A designer's
 * only recourse was to pin the image to a literal URL, which bakes THAT account's
 * file into the template and shows the wrong dealer's logo everywhere else.
 *
 * So the binding carries a `variant` instead, and the data carries every variant
 * the account actually has. The template says "the dark one" and each account
 * resolves its own.
 */

export const LOGO_VARIANTS = ['light', 'dark', 'white', 'black'] as const;

export type LogoVariant = (typeof LOGO_VARIANTS)[number];

export const LOGO_VARIANT_LABEL: Record<LogoVariant, string> = {
  light: 'Light',
  dark: 'Dark',
  white: 'White',
  black: 'Black',
};

/** A sub-account's logo set, as `accountData.logos` / the `logos` JSON column. */
export type AccountLogos = Partial<Record<LogoVariant, string | undefined>> | null | undefined;

export function isLogoVariant(v: unknown): v is LogoVariant {
  return typeof v === 'string' && (LOGO_VARIANTS as readonly string[]).includes(v);
}

/** The {@link AdData} key holding one variant's URL, e.g. `dark` → `logoUrlDark`. */
export function logoVariantDataKey(variant: LogoVariant): string {
  return `logoUrl${variant[0].toUpperCase()}${variant.slice(1)}`;
}

/** The variants this account actually has a file for, in display order. */
export function availableLogoVariants(
  logos: AccountLogos,
): { key: LogoVariant; label: string; url: string }[] {
  if (!logos) return [];
  return LOGO_VARIANTS.flatMap((key) => {
    const url = logos[key];
    return url ? [{ key, label: LOGO_VARIANT_LABEL[key], url }] : [];
  });
}

/**
 * Brand-logo {@link AdData}: the default `logoUrl` plus one key per variant.
 *
 * `preferred` picks the default (the ad-level logo choice); absent, it's the
 * first variant on file. EVERY variant key is filled, falling back to that
 * default — so a template pinned to `dark` still renders a logo for an account
 * that hasn't uploaded one, rather than a hole where the logo should be.
 */
export function brandLogoData(logos: AccountLogos, preferred?: LogoVariant | null): AdData {
  const available = availableLogoVariants(logos);
  if (!available.length) return {};
  const fallback = (preferred && available.find((v) => v.key === preferred)?.url) || available[0].url;
  const data: AdData = { logoUrl: fallback };
  for (const variant of LOGO_VARIANTS) {
    data[logoVariantDataKey(variant)] = logos?.[variant] || fallback;
  }
  return data;
}
