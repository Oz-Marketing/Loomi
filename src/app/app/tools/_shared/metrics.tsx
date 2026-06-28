'use client';

import type { ReactNode } from 'react';
import { ChatBubbleOvalLeftIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { Tooltip } from './Tooltip';

export function MetricBox({
  label,
  value,
  sub,
  detail,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Optional faint second line — e.g. the arithmetic basis behind `value`. */
  detail?: string;
  color?: string;
}) {
  return (
    // No border + softer bg so it reads as a passive computed-info card,
    // not as another fillable field. Editable inputs stay bordered+filled.
    // `metric-box` lets the pacer card recess these into darker wells (see
    // `.pacer-ad-card .metric-box` in globals.css); harmless elsewhere.
    <div className="metric-box rounded-lg bg-[var(--muted)]/40 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
        {label}
      </div>
      <div className="text-lg font-bold leading-tight" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>
      )}
      {detail && (
        <div className="text-[10px] text-[var(--muted-foreground)]/75 mt-0.5 tabular-nums">
          {detail}
        </div>
      )}
    </div>
  );
}

// Tighter than MetricBox — single-line label + value, no sub text. Used
// in the Budget Calculator's stat strip where vertical space is
// precious (5+ stats in one row above a scrollable ad list).
export function CompactStat({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  const box = (
    <div className="min-w-0 w-full bg-[var(--muted)]/40 px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] truncate mb-0.5">
        {label}
      </div>
      <div
        className="text-sm font-bold tabular-nums leading-snug whitespace-nowrap"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
    </div>
  );
  // Loomi tooltip instead of the native title. The stat strip is a grid item,
  // so the wrapper stretches to fill its cell (min-w-0 keeps truncation).
  return title ? (
    <Tooltip label={title} className="min-w-0">
      {box}
    </Tooltip>
  ) : (
    box
  );
}

export function SectionLabel({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <h2 className="m-0 mb-3.5 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
      {icon}
      {text}
    </h2>
  );
}

export function Divider({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 my-4">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap">
        {icon}
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

export function UpdatesIndicator({
  count,
  hasAttachments,
}: {
  count: number;
  hasAttachments: boolean;
}) {
  const hasCount = count > 0;
  const titleParts: string[] = [];
  titleParts.push(`${count} update${count === 1 ? '' : 's'}`);
  if (hasAttachments) titleParts.push('has attachments');
  return (
    <Tooltip label={titleParts.join(' · ')} className="flex-shrink-0">
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: 28, height: 28 }}
    >
      <ChatBubbleOvalLeftIcon
        className="w-6 h-6"
        style={{
          color: hasCount ? 'var(--primary)' : 'var(--muted-foreground)',
          opacity: hasCount ? 1 : 0.55,
        }}
      />
      {hasCount && (
        <span
          className="absolute flex items-center justify-center text-[9px] font-bold text-white rounded-full"
          style={{
            bottom: -2,
            right: -4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            background: 'var(--primary)',
            border: '2px solid var(--background)',
            lineHeight: 1,
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hasAttachments && (
        <PaperClipIcon
          className="absolute w-3 h-3 text-[var(--muted-foreground)]"
          style={{ top: -2, right: -2 }}
        />
      )}
    </span>
    </Tooltip>
  );
}
