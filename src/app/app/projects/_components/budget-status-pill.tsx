'use client';

import { STATUS_STYLE, statusLabel } from './budget-shared';

/** A budget line's status as a small pill. Shared by the hub list and drawer. */
export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        STATUS_STYLE[status] ?? STATUS_STYLE.planned
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}
