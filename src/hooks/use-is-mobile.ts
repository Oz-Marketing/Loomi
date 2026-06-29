'use client';

import { useEffect, useState } from 'react';

/**
 * True below the `md` breakpoint (≤767px) — where the sidebar becomes an
 * off-canvas drawer and collapsed-rail affordances don't apply. SSR-safe:
 * starts false (desktop) and corrects on mount.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isMobile;
}
