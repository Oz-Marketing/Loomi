'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '@/contexts/theme-context';
import { generateLoomiAvatarDataUri } from '@/lib/avatar';

interface AccountAvatarProps {
  name?: string | null;
  accountKey?: string | null;
  storefrontImage?: string | null;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  size?: number;
  className?: string;
  alt?: string;
  /**
   * Tailwind padding for a LOGO image inside the box. The 15% default keeps
   * logos off the edge at the small sizes most callers use, but it shrinks a
   * wide wordmark to almost nothing when the avatar is rendered large — pass a
   * tighter value (e.g. "p-[6%]") at display sizes. No effect on the generated
   * fallback, which is drawn to fill.
   */
  logoInsetClassName?: string;
  /**
   * 'square' (default) is the avatar treatment every list and table uses.
   * 'auto' fixes the HEIGHT to `size` and lets the width follow the image's own
   * aspect — a wide wordmark in a square box is capped by the box's width, so
   * it renders a fraction of the height you asked for. Only meaningful for a
   * real logo; the generated fallback is square either way.
   */
  aspect?: 'square' | 'auto';
  /** Upper bound on width in 'auto' mode, so a very wide mark can't run away. */
  maxWidth?: number;
}

export function AccountAvatar({
  name,
  accountKey,
  storefrontImage,
  logos,
  size = 48,
  logoInsetClassName = 'p-[15%]',
  aspect = 'square',
  maxWidth,
  className = '',
  alt,
}: AccountAvatarProps) {
  const { theme } = useTheme();
  const [hasImageError, setHasImageError] = useState(false);

  // Pick theme-appropriate logo: light mode → dark logo, dark mode → light logo
  const themeLogoSrc = theme === 'light' ? logos?.dark : logos?.light;

  useEffect(() => {
    setHasImageError(false);
  }, [themeLogoSrc, storefrontImage]);

  const fallbackSrc = useMemo(
    () => generateLoomiAvatarDataUri(name, accountKey, Math.max(size, 96), theme),
    [name, accountKey, size, theme],
  );

  // Priority: theme-appropriate logo > storefront image > generated fallback
  const primarySrc = themeLogoSrc || storefrontImage;
  const src = primarySrc && !hasImageError ? primarySrc : fallbackSrc;
  const isLogo = Boolean(themeLogoSrc) && !hasImageError;

  // 'auto' only pays off for a real logo — the generated fallback is square, so
  // letting it stretch would just distort it.
  const freeWidth = aspect === 'auto' && isLogo;

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden ${className}`}
      style={
        freeWidth
          ? { height: size, maxWidth: maxWidth ?? size * 4 }
          : { width: size, height: size }
      }
    >
      <img
        src={src}
        alt={alt || (name ? `${name} account avatar` : 'Account avatar')}
        height={size}
        className={
          freeWidth
            ? `h-full w-auto object-contain ${logoInsetClassName}`
            : `w-full h-full ${isLogo ? `object-contain ${logoInsetClassName}` : 'object-cover'}`
        }
        onError={() => setHasImageError(true)}
      />
    </span>
  );
}
