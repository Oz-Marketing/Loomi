'use client';

/**
 * The section card every report block sits in.
 *
 * Adds one thing the old `Section` could not do: a `controls` slot on the
 * header row. The reference dashboards put a chart's own range picker or metric
 * toggle inside the card it affects, rather than stacking every control at the
 * top of the page where nothing says which chart they apply to. `subtitle` still
 * works and now shares the right side with `controls`.
 */

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { CARD, HEADING, BODY } from './scale';

export function ChartCard({
  title,
  subtitle,
  icon: Icon,
  controls,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Range pickers, metric toggles — anything scoped to THIS card. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`glass-section-card ${CARD}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />}
          <h3 className={HEADING}>{title}</h3>
        </div>
        <div className="flex items-center gap-3">
          {subtitle && <p className={`text-xs ${BODY}`}>{subtitle}</p>}
          {controls}
        </div>
      </div>
      {children}
    </section>
  );
}
