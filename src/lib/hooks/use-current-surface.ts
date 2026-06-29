'use client';

import { useEffect, useState } from 'react';
import { getCurrentSurface } from '@/lib/cross-site';

/**
 * The surface the user is currently on ('studio' | 'reporting' | 'app'), or
 * null until hydration. Surface is host-derived (client-only), so we read it in
 * an effect after mount to avoid an SSR/client hydration mismatch — callers get
 * null on the first render, then the real surface. Gate UI on `=== 'app'` (not
 * `!== 'studio'`) so the brief null window defaults to the Studio/full view.
 */
export function useCurrentSurface(): 'studio' | 'reporting' | 'app' | null {
  const [surface, setSurface] = useState<'studio' | 'reporting' | 'app' | null>(null);
  useEffect(() => {
    setSurface(getCurrentSurface());
  }, []);
  return surface;
}
