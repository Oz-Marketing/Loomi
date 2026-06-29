'use client';

import {
  AD_STATUS_COLORS,
  APPROVAL_STATUS_COLORS,
  DESIGN_STATUS_COLORS,
} from '@/lib/ad-pacer/constants';

/**
 * Status pills — solid [bg, fg] chips from the shared color tables. Ad, design,
 * and approval statuses all use the same solid family so the three read as one
 * signal set. Falls back to the muted treatment for an unmapped status.
 */
export function AdStatusPill({ status }: { status: string }) {
  const [bg, color] = AD_STATUS_COLORS[status] ?? [
    'var(--muted)',
    'var(--muted-foreground)',
  ];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

export function ApprovalPill({ status }: { status: string }) {
  const [bg, color] = APPROVAL_STATUS_COLORS[status] ?? [
    'var(--muted)',
    'var(--muted-foreground)',
  ];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

export function DesignPill({ status }: { status: string }) {
  const [bg, color] = DESIGN_STATUS_COLORS[status] ?? [
    'var(--muted)',
    'var(--muted-foreground)',
  ];
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}
