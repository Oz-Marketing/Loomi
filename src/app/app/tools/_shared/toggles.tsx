'use client';

import { Fragment } from 'react';
import {
  sourceColor,
  sourceTint,
  budgetTypeColor,
  budgetTypeTint,
} from '@/lib/ad-pacer/helpers';
import { Tooltip } from './Tooltip';

export function BudgetTypeToggle({
  value,
  onChange,
}: {
  value: 'Daily' | 'Lifetime';
  onChange: (v: 'Daily' | 'Lifetime') => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--input)] overflow-hidden">
      {(['Daily', 'Lifetime'] as const).map((t) => {
        const active = value === t;
        const tint = budgetTypeTint(t);
        const fg = budgetTypeColor(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              background: active ? tint : 'transparent',
              color: active ? fg : 'var(--muted-foreground)',
              borderRight: t === 'Daily' ? '1px solid var(--border)' : 'none',
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

export function BudgetSourceToggle({
  value,
  onChange,
  stretch = false,
}: {
  value: 'base' | 'added' | 'split';
  onChange: (v: 'base' | 'added' | 'split') => void;
  /**
   * Fill the container at input height, segments sharing the width evenly —
   * for grid rows where the toggle sits in a column beside text/date fields
   * (the bulk-add modal) and has to line up with them.
   */
  stretch?: boolean;
}) {
  const opts = ['base', 'added', 'split'] as const;
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--input)] overflow-hidden ${
        stretch ? 'flex h-[38px] w-full' : 'inline-flex'
      }`}
    >
      {opts.map((t, i) => {
        const active = value === t;
        // Tint + accent come straight from the shared source helpers so the
        // toggle matches the overview's Base/Added/Split badges exactly —
        // Split reads pink (COLORS.split), not the lifetime violet.
        const tint = sourceTint(t);
        const fg = sourceColor(t);
        const button = (
          <button
            type="button"
            onClick={() => onChange(t)}
            className={`px-3.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              stretch ? 'h-full w-full' : 'py-1.5'
            }`}
            style={{
              background: active ? tint : 'transparent',
              color: active ? fg : 'var(--muted-foreground)',
              borderRight: i < opts.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            {t === 'base' ? 'Base' : t === 'added' ? 'Added' : 'Split'}
          </button>
        );
        // In stretch mode each segment owns an equal share of the row; the
        // split segment's Tooltip wrapper is the flex child, so it carries the
        // flex-1 and the button fills it.
        return t === 'split' ? (
          <Tooltip
            key={t}
            label="Split — allocation drawn from both Base and Added budgets"
            className={stretch ? 'flex-1' : ''}
          >
            {button}
          </Tooltip>
        ) : stretch ? (
          <div key={t} className="flex-1">
            {button}
          </div>
        ) : (
          <Fragment key={t}>{button}</Fragment>
        );
      })}
    </div>
  );
}
