'use client';

import { useTheme } from '@/contexts/theme-context';

/**
 * The "loomi" wordmark — the platform's own brand, as distinct from the Studio
 * lockup that `AppLogo` serves.
 *
 * Lives in `src/components/` rather than under one surface's `_components/`
 * because more than one surface uses it: the App sidebar and the Docs shell,
 * which is reached from Studio, Reporting and the App alike and should not be
 * branded as any one of them.
 *
 * Previously hotlinked from DigitalOcean Spaces, at filenames matching the old
 * GoHighLevel *studio* assets — so this component was showing a copy of the
 * studio lockup rather than the bare "loomi" mark it names. Both problems go
 * away by serving the real mark from our own origin. See app-logo.tsx for why
 * these are PNG rather than the source WebP.
 *
 * `LIGHT`/`DARK` name the THEME, not the ink — light theme takes the black-ink
 * mark, dark theme the white one.
 */
const LOOMI_LOGO_LIGHT_URL = '/brand/loomi-black.png';
const LOOMI_LOGO_DARK_URL = '/brand/loomi-white.png';

export function LoomiWordmark({ className = 'h-8 w-auto' }: { className?: string }) {
  const { theme } = useTheme();
  const src = theme === 'light' ? LOOMI_LOGO_LIGHT_URL : LOOMI_LOGO_DARK_URL;
  return <img src={src} alt="loomi" className={className} />;
}
