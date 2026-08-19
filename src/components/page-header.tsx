import * as React from 'react';
import { AccountScopeToggle } from '@/components/account-scope-toggle';

/**
 * Shared sticky page header — the canonical studio page-title section:
 * an optional accent icon, a bold title, an optional subtitle, optional
 * right-aligned actions, and an optional in-header tab strip.
 *
 * It renders the global `.page-sticky-header` chrome, so it pins to the top
 * of the scrolling content card and goes opaque on scroll on BOTH surfaces
 * (the studio AppShell and the reporting layout share one `SurfaceShell`
 * card that carries the `data-scrolled` flag). Pass `tabs` to pin a tab row
 * inside the header so it never scrolls away (`.has-tabs` drops the bottom
 * padding since the tab underline becomes the divider).
 *
 * Pass `scoped` on pages whose CONTENT changes with the roll-up choice (anything
 * reading `isRollup`) to surface the group scope toggle here. It is opt-in
 * rather than automatic because a control that appears on a page it cannot
 * affect is worse than no control — see docs/account-scope.md.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  tabs,
  scoped = false,
  className = 'mb-6',
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Tab strip pinned inside the header. Renders inside the `.has-tabs` divider row. */
  tabs?: React.ReactNode;
  /**
   * Show the group roll-up toggle. Set it on pages that read `isRollup`; it
   * renders nothing when the selection is not a group.
   */
  scoped?: boolean;
  /** Bottom-margin / spacing utility. Defaults to `mb-6` to match studio pages. */
  className?: string;
}) {
  return (
    <div className={`page-sticky-header ${tabs ? 'has-tabs ' : ''}${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-7 h-7 text-[var(--primary)]" />}
          <div>
            <h2 className="text-2xl font-bold">{title}</h2>
            {subtitle && (
              <p className="text-[var(--muted-foreground)] mt-1">{subtitle}</p>
            )}
          </div>
        </div>

        {(scoped || actions) && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {scoped && <AccountScopeToggle />}
            {actions}
          </div>
        )}
      </div>

      {tabs && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {tabs}
        </div>
      )}
    </div>
  );
}
