'use client';

import { useTheme } from '@/contexts/theme-context';

/**
 * The "loomi" app wordmark (the App surface's own brand). Mirrors the Studio
 * AppLogo pattern: a theme-swapped hosted PNG (light wordmark on light theme,
 * white wordmark on dark theme).
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
