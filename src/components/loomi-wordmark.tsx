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
 * Mirrors the AppLogo pattern: a theme-swapped hosted PNG — dark wordmark on
 * light theme, white wordmark on dark.
 */
const LOOMI_LOGO_LIGHT_URL =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/0e5d3572ac57443c9bbdc3f97b22eb64/6995362fd614c941e221bb2e.png';
const LOOMI_LOGO_DARK_URL =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/20a1fcc5a766493f8ab1d8c38c1a396b/6995362fbf62aa8d0c6c62be.png';

export function LoomiWordmark({ className = 'h-8 w-auto' }: { className?: string }) {
  const { theme } = useTheme();
  const src = theme === 'light' ? LOOMI_LOGO_LIGHT_URL : LOOMI_LOGO_DARK_URL;
  return <img src={src} alt="loomi" className={className} />;
}
