'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BellAlertIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface ApiNotification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  link: string | null;
  metaJson: string | null;
  emailedAt: string | null;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY_BORDER: Record<ApiNotification['severity'], string> = {
  info: 'border-l-[var(--primary)]',
  warning: 'border-l-amber-400',
  critical: 'border-l-red-400',
};

const SEVERITY_ICON_COLOR: Record<ApiNotification['severity'], string> = {
  info: 'text-[var(--primary)]',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(1, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NotificationsPanelProps {
  onClose: () => void;
  onChange?: (unread: number) => void;
}

export function NotificationsPanel({ onClose, onChange }: NotificationsPanelProps) {
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?limit=50${filter === 'unread' ? '&unreadOnly=1' : ''}`);
      if (!res.ok) return;
      const data = (await res.json()) as { items: ApiNotification[]; unreadCount: number };
      setItems(data.items);
      onChange?.(data.unreadCount);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter, onChange]);

  useEffect(() => {
    load();
  }, [load]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unreadCount = useMemo(
    () => items.filter((i) => !i.readAt).length,
    [items],
  );

  const handleItemClick = async (item: ApiNotification) => {
    if (!item.readAt) {
      // Optimistic update
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
      );
      onChange?.(Math.max(0, unreadCount - 1));
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [item.id] }),
        });
      } catch {
        /* ignore */
      }
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: new Date().toISOString() })));
    onChange?.(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 animate-overlay-in" onClick={onClose}>
      <div
        ref={panelRef}
        // frost-heavy, not glass-panel: the panel sits over dense page content
        // (tables, budget cards) with no scrim, and the lighter glass let it all
        // read through. Same treatment as the notes / budget-log drawers.
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[420px] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellAlertIcon className="w-5 h-5 text-black dark:text-[var(--primary)]" />
            <h3 className="text-sm font-bold tracking-tight">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-[var(--primary)] text-[var(--primary-foreground)]">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-[var(--sidebar-border-soft)] overflow-hidden">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors"
                style={{
                  background:
                    filter === f ? 'var(--primary)' : 'transparent',
                  color:
                    filter === f ? 'white' : 'var(--sidebar-muted-foreground)',
                }}
              >
                {f === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] disabled:opacity-50 transition-colors"
          >
            <CheckIcon className="w-3.5 h-3.5" />
            Mark all read
          </button>
        </div>

        <div className="themed-scrollbar flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="text-[11px] text-[var(--sidebar-muted-foreground)] text-center py-8">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-[var(--sidebar-muted-foreground)] text-center py-8">
              {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const unread = !item.readAt;
                const Icon =
                  item.severity === 'critical'
                    ? ExclamationTriangleIcon
                    : item.severity === 'warning'
                      ? ExclamationTriangleIcon
                      : InformationCircleIcon;
                const inner = (
                  <div
                    className={`group rounded-lg border-l-4 ${SEVERITY_BORDER[item.severity]} bg-[var(--sidebar-input)]/40 hover:bg-[var(--sidebar-muted)]/70 transition-colors px-3 py-2.5 cursor-pointer`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${SEVERITY_ICON_COLOR[item.severity]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={`text-xs leading-snug ${
                              unread ? 'font-semibold text-[var(--sidebar-foreground)]' : 'text-[var(--sidebar-muted-foreground)]'
                            }`}
                          >
                            {item.title}
                          </p>
                          <span className="text-[10px] text-[var(--sidebar-muted-foreground)] flex-shrink-0 whitespace-nowrap">
                            {formatRelative(item.createdAt)}
                          </span>
                        </div>
                        {item.body && (
                          <p className="text-[11px] text-[var(--sidebar-muted-foreground)] mt-0.5 leading-snug">
                            {item.body}
                          </p>
                        )}
                      </div>
                      {unread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  </div>
                );
                if (item.link) {
                  return (
                    <Link
                      key={item.id}
                      href={item.link}
                      onClick={() => {
                        handleItemClick(item);
                        onClose();
                      }}
                      className="block"
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <div key={item.id} onClick={() => handleItemClick(item)}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
