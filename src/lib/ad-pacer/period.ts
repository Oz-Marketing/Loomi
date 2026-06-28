/**
 * Period helpers — periods are `YYYY-MM` strings that bucket ads into a
 * planning month. The selector + URL state both round-trip through these.
 */

import { toIso, type DatePreset } from '@/components/ui/date-picker';

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtPeriodLong(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function fmtPeriodShort(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Flight-date presets scoped to the ad's planning period (YYYY-MM).
 * Lets the user one-click "fill the whole month" instead of clicking
 * through the calendar.
 */
export function flightDatePresets(period: string): DatePreset[] {
  if (!isValidPeriod(period)) return [];
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstIso = `${y}-${pad(m)}-01`;
  const lastIso = `${y}-${pad(m)}-${pad(lastDay)}`;
  const midIso = `${y}-${pad(m)}-${pad(Math.min(14, lastDay))}`;
  return [
    {
      label: 'Full month',
      range: () => ({ start: firstIso, end: lastIso }),
    },
    {
      label: 'First half',
      range: () => ({ start: firstIso, end: midIso }),
    },
    {
      label: 'Second half',
      range: () => ({
        start: `${y}-${pad(m)}-${pad(Math.min(15, lastDay))}`,
        end: lastIso,
      }),
    },
  ];
}

export const TODAY_PRESET: DatePreset = {
  label: 'Today',
  single: () => toIso(new Date()),
};
