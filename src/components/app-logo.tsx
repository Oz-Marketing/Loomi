'use client';

import { useTheme } from '@/contexts/theme-context';

/**
 * The "loomi studio" lockup, theme-swapped.
 *
 * These used to be hotlinked from a GoHighLevel CDN
 * (`storage.googleapis.com/msgsndr/...`) — a third party we no longer run
 * anything on. Every logo in the product, on the login page, and in
 * transactional mail depended on an account nobody here controls staying
 * alive. They are served from our own origin now.
 *
 * PNG rather than the source WebP: measured within 0.2KB of WebP at this
 * width, and the same file is used in email HTML, where Outlook cannot render
 * WebP. One asset for both surfaces beats a `<picture>` fallback to maintain.
 *
 * `LIGHT`/`DARK` name the THEME, not the ink — the light theme gets the
 * black-ink mark, the dark theme the white one.
 */
export const APP_LOGO_LIGHT_URL = '/brand/loomi-studio-black.png';
export const APP_LOGO_DARK_URL = '/brand/loomi-studio-white.png';

export function AppLogo({
  className = 'h-8 w-auto',
  alt = 'Loomi Studio',
}: {
  className?: string;
  alt?: string;
}) {
  const { theme } = useTheme();
  const src = theme === 'light' ? APP_LOGO_LIGHT_URL : APP_LOGO_DARK_URL;

  return <img src={src} alt={alt} className={className} />;
}
