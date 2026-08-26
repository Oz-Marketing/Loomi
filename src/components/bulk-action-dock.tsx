'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

export interface BulkActionDockItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface BulkActionDockProps {
  count: number;
  itemLabel: string;
  actions: BulkActionDockItem[];
  onClose: () => void;
}

export default function BulkActionDock({
  count,
  itemLabel,
  actions,
  onClose,
}: BulkActionDockProps) {
  const visibleActions = actions.filter((action) => !action.disabled || action.id === 'select-all');

  // Portal to document.body so the dock isn't trapped inside any ancestor
  // with `transform` set (e.g., `animate-fade-in-up`), which would otherwise
  // become the containing block for `position: fixed` and pin the dock
  // somewhere off-screen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed bottom-6 left-[calc(50%+9.25rem)] z-40 w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-fade-in-up">
      <div className="loomi-bulk-dock flex items-center rounded-2xl border px-2 py-1.5 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="loomi-bulk-dock-count inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-[var(--primary)] px-2 text-xs font-semibold text-[var(--primary-foreground)]">
            {count}
          </span>
          <span className="text-[13px] font-semibold text-[var(--foreground)] whitespace-nowrap">
            {count} {itemLabel} selected
          </span>
        </div>

        <span className="loomi-bulk-dock-sep mx-1 h-8 w-px" />

        <div className="flex items-center">
          {visibleActions.map((action, index) => (
            <div key={action.id} className="flex items-center">
              <button
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className={`loomi-bulk-dock-action inline-flex min-w-[88px] flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${action.danger ? 'loomi-bulk-dock-action-danger' : ''}`}
              >
                <span className="h-4 w-4">{action.icon}</span>
                <span className="whitespace-nowrap">{action.label}</span>
              </button>
              {index < visibleActions.length - 1 && <span className="loomi-bulk-dock-sep mx-1 h-8 w-px" />}
            </div>
          ))}
        </div>

        <span className="loomi-bulk-dock-sep mx-1 h-8 w-px" />

        <button
          type="button"
          onClick={onClose}
          className="loomi-bulk-dock-close inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Close bulk actions"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
