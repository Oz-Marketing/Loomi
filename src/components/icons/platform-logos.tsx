// Full-colour hosted brand marks for the ad tools (Planner / Pacer), distinct
// from the monochrome nav glyph in meta-logo.tsx. Plain <img> — the assets live
// on Loomi's CDN; `object-contain` keeps them inside the caller's w-/h- box.

const META_LOGO_URL =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/3face4a77aba4762a1b40a3dc1cb83a9/meta_PNG5.png';
const GOOGLE_ADS_LOGO_URL =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/cb1a63cf8e864f86847c492256bc83cd/google_ads_logo_icon_171064.webp';

/** Meta brand mark — used on the "Synced from Meta" badges in the Pacer. */
export function MetaBrandIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={META_LOGO_URL}
      alt="Meta"
      className={`${className ?? ''} object-contain`.trim()}
    />
  );
}

/** Google Ads brand mark — used on the "Synced from Google" badges (§8). */
export function GoogleAdsBrandIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={GOOGLE_ADS_LOGO_URL}
      alt="Google Ads"
      className={`${className ?? ''} object-contain`.trim()}
    />
  );
}

/**
 * YouTube play mark. Inline SVG rather than a hosted asset like the two above —
 * there's no YouTube file on the CDN, and the shape is simple enough that
 * drawing it beats adding an upload step to a UI change.
 */
export function YouTubeBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="YouTube"
      className={`${className ?? ''} object-contain`.trim()}
    >
      <path
        fill="#FF0000"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8Z"
      />
      <path fill="#FFF" d="M9.6 15.6 15.8 12 9.6 8.4v7.2Z" />
    </svg>
  );
}
