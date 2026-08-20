'use client';

import { useTheme } from '@/contexts/theme-context';

/**
 * The bare "loomi" wordmark — the App surface's own brand, without the
 * "studio" suffix the Studio surface carries.
 *
 * Previously hotlinked from DigitalOcean Spaces, and pointing at files whose
 * names match the old GoHighLevel studio assets — i.e. the App surface was
 * showing a copy of the studio lockup rather than its own. Both problems go
 * away by serving the real "loomi" mark from our own origin. See app-logo.tsx
 * for why these are PNG.
 *
 * `LIGHT`/`DARK` name the THEME, not the ink.
 */
const LOOMI_LOGO_LIGHT_URL = '/brand/loomi-black.png';
const LOOMI_LOGO_DARK_URL = '/brand/loomi-white.png';

export function LoomiWordmark({ className = 'h-8 w-auto' }: { className?: string }) {
  const { theme } = useTheme();
  const src = theme === 'light' ? LOOMI_LOGO_LIGHT_URL : LOOMI_LOGO_DARK_URL;
  return <img src={src} alt="loomi" className={className} />;
}
