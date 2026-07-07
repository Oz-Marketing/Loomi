'use client';

/**
 * Shared /templates layout: a search box on top, then a two-column body with the
 * left filter rail and the cards grid. The rail is always visible on large
 * screens and collapses behind a "Filters" toggle on small ones. Every tab
 * renders <TemplateLibraryShell search rail>{grid}</TemplateLibraryShell>.
 */
import { useState } from 'react';
import { FunnelIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

/**
 * The shared "no templates yet" card every tab shows when its library is empty
 * (rail hidden). Icon + copy + a primary Create action, consistent across kinds.
 */
export function TemplateEmptyState({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[var(--muted-foreground)]" />
      </div>
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">{subtitle}</p>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <PlusIcon className="w-4 h-4" />
        {actionLabel}
      </button>
    </div>
  );
}

export function TemplateLibraryShell({
  rail,
  resultCount,
  children,
}: {
  /** A <TemplateFilterRail/> element (or null when there's nothing to filter). */
  rail: React.ReactNode;
  resultCount?: number;
  children: React.ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(false);

  return (
    <div>
      {/* Mobile-only filter toggle — the rail (with its own search box) collapses
          behind it on small screens; on desktop the rail is always shown. */}
      {rail && (
        <div className="mb-4 lg:hidden">
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            {railOpen ? <XMarkIcon className="h-4 w-4" /> : <FunnelIcon className="h-4 w-4" />}
            Filters
          </button>
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {rail && (
          // On desktop the rail sticks below the docked page header and scrolls
          // on its own (independent of the cards column) so a long facet list
          // never pushes the page — `top` clears the compacted sticky header,
          // `max-h` caps it to the remaining viewport.
          <div
            className={`${railOpen ? 'block' : 'hidden'} lg:sticky lg:top-[128px] lg:block lg:max-h-[calc(100vh-13rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1`}
          >
            {rail}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {children}
          {typeof resultCount === 'number' && (
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              {resultCount} template{resultCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
