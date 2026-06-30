'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

export interface TemplateLibraryItem {
  id: string;
  design: string;
  name: string;
  category?: string | null;
  type?: string;
  published?: boolean;
  publishedAt?: string | null;
  updatedAt: string;
}

function formatUpdated(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface TemplateLibraryPanelProps {
  onSelect: (design: string) => void;
  /**
   * When provided, renders a "Create New" button that spins up a fresh
   * template scoped to the current sub-account and drops the user straight
   * into the editor. The mode arg picks the builder (drag-and-drop vs HTML).
   */
  onCreateNew?: (mode: 'visual' | 'code') => void;
}

/**
 * Embedded template picker used by the Message step (both standalone-email
 * and multi-channel Email tab). Fetches /api/templates, renders cards with
 * iframe thumbnails, includes search. Calls onSelect with the design slug
 * when the user clicks a card; calls onCreateNew when the user creates one.
 */
export function TemplateLibraryPanel({ onSelect, onCreateNew }: TemplateLibraryPanelProps) {
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((items: unknown) => {
        if (cancelled) return;
        setTemplates(Array.isArray(items) ? (items as TemplateLibraryItem[]) : []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? templates.filter(
          (t) =>
            t.name?.toLowerCase().includes(query) ||
            t.design?.toLowerCase().includes(query) ||
            t.category?.toLowerCase().includes(query),
        )
      : templates;
    return [...filtered].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [templates, search]);

  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">    
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--border)] flex-wrap">
        <p className="text-base font-semibold">Templates</p>
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[520px]">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>
          {onCreateNew && <CreateNewMenu onCreate={onCreateNew} />}
        </div>
      </div>
      <div className="p-5">
        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2 py-8">
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
            Loading templates…
          </p>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-12">
            <DocumentTextIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">
              {search ? 'No templates match that search.' : 'No templates in the library yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTemplates.map((t) => (
              <TemplateCard key={t.id} template={t} onClick={() => onSelect(t.design)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Create New" split button. Opens a small menu so the user picks the
 * builder (Drag & Drop vs HTML) before being dropped into the editor.
 */
function CreateNewMenu({ onCreate }: { onCreate: (mode: 'visual' | 'code') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const pick = (mode: 'visual' | 'code') => {
    setOpen(false);
    onCreate(mode);
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-2 text-sm font-medium text-white hover:bg-[var(--primary)] transition-colors whitespace-nowrap"
      >
        <PlusIcon className="w-4 h-4" />
        Create New
        <ChevronDownIcon className="w-3.5 h-3.5 opacity-80" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-44 glass-dropdown overflow-hidden">
          <button
            type="button"
            onClick={() => pick('visual')}
            className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            Drag &amp; Drop
          </button>
          <button
            type="button"
            onClick={() => pick('code')}
            className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            HTML editor
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onClick,
}: {
  template: TemplateLibraryItem;
  onClick: () => void;
}) {
  const [thumbHtml, setThumbHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rawRes = await fetch(
          `/api/templates?design=${encodeURIComponent(template.design)}&format=raw`,
        );
        const rawData = await rawRes.json().catch(() => ({}));
        if (!rawRes.ok || !rawData?.raw) return;
        const previewRes = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: String(rawData.raw), previewValues: {} }),
        });
        const previewData = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok || !previewData?.html) return;
        if (!cancelled) setThumbHtml(String(previewData.html));
      } catch {
        // Thumbnail is decorative — silent failure is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.design]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden hover:border-[var(--primary)]/60 transition-colors group flex flex-col"
    >
      <div className="aspect-[3/4] relative overflow-hidden bg-white border-b border-[var(--border)]">
        {thumbHtml ? (
          <iframe
            title=""
            aria-hidden
            srcDoc={thumbHtml}
            sandbox=""
            className="absolute top-0 left-0 origin-top-left pointer-events-none"
            style={{
              width: '600px',
              height: '800px',
              transform: 'scale(0.45)',
              transformOrigin: 'top left',
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ArrowPathIcon className="w-5 h-5 text-[var(--muted-foreground)] animate-spin opacity-50" />
          </div>
        )}
      </div>
      <div className="p-3 flex-1">
        <p className="text-sm font-medium text-[var(--foreground)] truncate">
          {template.name || template.design}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {template.published && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90">
              <CheckCircleIcon className="w-3 h-3" />
              Published
            </span>
          )}
          {template.updatedAt && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Updated {formatUpdated(template.updatedAt)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
