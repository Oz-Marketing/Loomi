'use client';

import { useMemo } from 'react';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { AD_STATUS_COLORS, STATUS_PRIORITY } from '@/lib/ad-pacer/constants';
import { Tooltip } from './Tooltip';

/**
 * Battery-style segmented bar showing the breakdown of Ad Statuses across an
 * account's full ad list. Width of each segment = proportion of ads in that
 * status. Ordered by status priority (worst → best) so problems are visible
 * on the left.
 */
export function StatusBattery({
  ads,
  size = 'sm',
}: {
  ads: PacerAd[];
  size?: 'sm' | 'lg';
}) {
  const total = ads.length;
  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    ads.forEach((a) => {
      const s = a.adStatus || 'In Draft';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    });
    return STATUS_PRIORITY.flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [{ status, count }] : [];
    });
  }, [ads]);

  const barHeight = size === 'lg' ? 'h-3.5' : 'h-2.5';
  const labelText = size === 'lg' ? 'text-[11px]' : 'text-[10px]';

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        <div className={`${barHeight} w-64 rounded-full border border-dashed border-[var(--border)]`} />
        <span>No ads yet</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 min-w-0 w-full">
      <div className="flex flex-col gap-1 min-w-[320px] flex-1">
        <div className={`flex ${barHeight} w-full rounded-full overflow-hidden bg-[var(--muted)] border border-[var(--border)]`}>
          {breakdown.map(({ status, count }) => {
            const w = (count / total) * 100;
            // [0] = bg color (the solid status color); [1] is the text color
            // (now #ffffff for every status, which would render the bar blank).
            const color = AD_STATUS_COLORS[status]?.[0] ?? 'var(--muted-foreground)';
            return (
              <Tooltip
                key={status}
                label={`${status}: ${count} of ${total} (${w.toFixed(0)}%)`}
                className="h-full transition-[width] duration-500"
                style={{ width: `${w}%`, background: color }}
              />
            );
          })}
        </div>
        <div className={`flex items-center gap-x-2 gap-y-0.5 ${labelText} text-[var(--muted-foreground)] flex-wrap`}>
          <span className="font-semibold text-[var(--foreground)]">
            {total} ad{total !== 1 ? 's' : ''}
          </span>
          {breakdown.map(({ status, count }) => {
            const color = AD_STATUS_COLORS[status]?.[0] ?? 'var(--muted-foreground)';
            return (
              <span
                key={status}
                className="inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span
                  className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                  style={{ background: color }}
                />
                {count} {status}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
