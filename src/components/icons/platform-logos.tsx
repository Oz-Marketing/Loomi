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
