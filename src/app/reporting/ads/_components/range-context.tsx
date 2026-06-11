'use client';

/**
 * Shared date-range + comparison state for the Digital Ads area, provided by
 * the /reporting/ads layout. Because the layout doesn't unmount when you
 * navigate between report routes, this state persists across platform switches
 * — pick a window once and it follows you from Meta to OTT to Google.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  type DateRangeKey,
  type CustomDateRange,
  resolveBounds,
  metaLookbackFloor,
} from './shared';

interface RangeContextValue {
  rangeKey: DateRangeKey;
  setRangeKey: (k: DateRangeKey) => void;
  customRange: CustomDateRange | null;
  onCustomRange: (r: CustomDateRange) => void;
  compareTo: string;
  setCompareTo: (v: string) => void;
  from: string;
  to: string;
  floor: string;
  /** Jump to a preset (used by the "no data" empty-state button). */
  onJump: (k: DateRangeKey) => void;
}

const RangeContext = createContext<RangeContextValue | null>(null);

export function RangeProvider({ children }: { children: ReactNode }) {
  const [rangeKey, setRangeKey] = useState<DateRangeKey>('6m');
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [compareTo, setCompareTo] = useState<string>('none');
  const floor = useMemo(() => metaLookbackFloor(), []);
  const { from, to } = useMemo(() => resolveBounds(rangeKey, customRange), [rangeKey, customRange]);

  // Clamp a custom range's start to the lookback floor before it hits any API.
  const onCustomRange = (r: CustomDateRange) => {
    const floorDate = new Date(`${floor}T00:00:00`);
    setCustomRange({ start: r.start < floorDate ? floorDate : r.start, end: r.end });
  };
  const onJump = (k: DateRangeKey) => {
    setCustomRange(null);
    setRangeKey(k);
  };

  const value: RangeContextValue = {
    rangeKey,
    setRangeKey,
    customRange,
    onCustomRange,
    compareTo,
    setCompareTo,
    from,
    to,
    floor,
    onJump,
  };
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeContextValue {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error('useRange must be used within the Digital Ads layout');
  return ctx;
}
