'use client';

import type { PacerAd } from '@/lib/ad-pacer/types';
import { fmtDate, flightElapsedPct, runDateColor } from '@/lib/ad-pacer/helpers';

/**
 * Run-dates bar (Monday-style): a status-colored progress bar behind the flight
 * window. The elapsed share of the run is filled in, the rest is a neutral
 * track; the bar color encodes the ad's status (see runDateColor).
 */
export function FlightBar({ ad }: { ad: PacerAd }) {
  if (!ad.flightStart || !ad.flightEnd) {
    return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
  }
  const pct = flightElapsedPct(ad.flightStart, ad.flightEnd);
  const color = runDateColor(ad.adStatus);
  return (
    <div className="relative h-[22px] min-w-[132px] w-full overflow-hidden rounded-full bg-[var(--muted)]">
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center px-2 text-[11px] font-semibold whitespace-nowrap text-white"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
      </span>
    </div>
  );
}
