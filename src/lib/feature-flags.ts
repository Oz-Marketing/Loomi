/**
 * Build-time feature flags.
 *
 * `NEXT_PUBLIC_*` values are inlined per build, so staging and production bake
 * their own values independently. Each flag is OFF unless explicitly set to
 * `'true'`, so production is gated BY DEFAULT — enable a feature in a given
 * environment by setting its env var there (and flip it on for production once
 * the feature is ready to ship).
 */

/**
 * The Ad Generator (`/ad-generator`). Not ready for production users yet,
 * so it's hidden from the nav and its route 404s unless
 * `NEXT_PUBLIC_ENABLE_AD_GENERATOR=true` is set for the environment.
 */
export const AD_GENERATOR_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_AD_GENERATOR === 'true';
