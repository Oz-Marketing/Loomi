'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  FLOW_BUILTIN_TAGS,
  FLOW_TAG_GROUP_ORDER,
  tokenFor,
  type FlowTag,
} from '@/lib/flows/merge-tag-catalog';

/**
 * "Custom Tags" picker for flow module text fields. A small `{x}` button that
 * opens a searchable, category-grouped dropdown of contact variables + the
 * account's custom fields, inserting a bare `{{key}}` token via `onInsert`.
 *
 * UX mirrors `src/components/variable-picker.tsx` (portal dropdown, search,
 * close-on-outside/scroll) but is driven by the flow merge-tag catalog and the
 * flow token format — not the ESP `{{contact.x}}` catalog.
 */
interface MergeTagPickerProps {
  /** Account's declared custom fields (key + label). Empty for library flows. */
  customFields: { key: string; label: string }[];
  onInsert: (token: string) => void;
}

export function MergeTagPicker({ customFields, onInsert }: MergeTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Full catalog: built-ins + the account's custom fields (snake_case keys).
  const tags = useMemo<FlowTag[]>(() => {
    const custom: FlowTag[] = customFields.map((cf) => ({
      key: cf.key,
      label: cf.label || cf.key,
      group: 'Custom',
    }));
    return [...FLOW_BUILTIN_TAGS, ...custom];
  }, [customFields]);

  // Filter by search, then group + order.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? tags.filter(
          (t) =>
            t.label.toLowerCase().includes(q) ||
            t.key.toLowerCase().includes(q),
        )
      : tags;
    const byGroup = new Map<string, FlowTag[]>();
    for (const t of matched) {
      const arr = byGroup.get(t.group) ?? [];
      arr.push(t);
      byGroup.set(t.group, arr);
    }
    return [...byGroup.entries()].sort((a, b) => {
      const ai = FLOW_TAG_GROUP_ORDER.indexOf(a[0]);
      const bi = FLOW_TAG_GROUP_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [tags, search]);

  // Position the dropdown under the button (flip up if no room below).
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropW = 256;
    const dropH = 320;
    const top =
      rect.bottom + 4 + dropH > window.innerHeight
        ? Math.max(8, rect.top - dropH - 4)
        : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.right - dropW, window.innerWidth - dropW - 8));
    setPos({ top, left });
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on scroll of any ancestor (not the dropdown's own list).
  useEffect(() => {
    if (!open) return;
    function onScroll(e: Event) {
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setSearch('');
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  // Focus the search box on open.
  useEffect(() => {
    if (open && pos) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, pos]);

  const insert = useCallback(
    (key: string) => {
      onInsert(tokenFor(key));
      setOpen(false);
      setSearch('');
    },
    [onInsert],
  );

  const dropdown =
    open &&
    pos &&
    createPortal(
      <div
        ref={dropdownRef}
        data-builder-popout-portal
        className="fixed z-[9999] w-64 max-h-80 rounded-lg border border-[var(--border)] backdrop-blur-xl shadow-[0_4px_16px_rgba(0,0,0,0.18)] overflow-hidden flex flex-col"
        style={{
          top: pos.top,
          left: pos.left,
          background: 'color-mix(in srgb, var(--background) 96%, transparent)',
        }}
      >
        <div className="p-2 border-b border-[var(--border)]">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-md focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {grouped.map(([group, entries]) => (
            <div key={group}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {group}
              </div>
              {entries.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => insert(t.key)}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary)]/10 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate">
                      {t.label}
                    </span>
                    <code className="text-[9px] font-mono text-[var(--muted-foreground)] opacity-60 truncate max-w-[120px]">
                      {tokenFor(t.key)}
                    </code>
                  </div>
                </button>
              ))}
            </div>
          ))}

          {grouped.length === 0 && (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">
              No tags match &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-[10px] font-medium text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors"
        title="Insert a contact variable or custom field"
      >
        <span className="font-bold leading-none">{'{x}'}</span>
        Tags
      </button>
      {dropdown}
    </>
  );
}
