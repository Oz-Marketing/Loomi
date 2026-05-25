'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  Squares2X2Icon,
  BoltIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';

// Sub-account-facing modal. Lists published flow templates (returned
// by GET /api/flows?templates=1&status=published) so the user can
// adopt one into their own account. On confirm, POSTs to /duplicate
// with their accountKey; the server stamps parentTemplateId so the
// new instance shows up in the template's adoption list back on the
// admin side.

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  updatedAt: string;
}

interface PickTemplateModalProps {
  open: boolean;
  /** Account that will own the new flow instance. */
  targetAccountKey: string;
  onClose: () => void;
  /** Called with the new flow's id once the clone succeeds. The
   *  caller typically navigates to /flows/{newId}. */
  onAdopted: (newFlowId: string) => void;
}

export function PickTemplateModal({
  open,
  targetAccountKey,
  onClose,
  onAdopted,
}: PickTemplateModalProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId(null);
    setAdopting(false);
    setTemplates(null);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/flows?templates=1&status=published');
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setLoadError(payload.error || 'Failed to load templates');
          return;
        }
        const list: TemplateRow[] = Array.isArray(payload.flows)
          ? payload.flows.map((f: TemplateRow) => ({
              id: f.id,
              name: f.name || 'Untitled template',
              description: f.description || '',
              nodeCount: f.nodeCount ?? 0,
              updatedAt: f.updatedAt,
            }))
          : [];
        if (!cancelled) setTemplates(list);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load templates');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !adopting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, adopting, onClose]);

  const filtered = useMemo(() => {
    if (!templates) return [];
    if (!search.trim()) return templates;
    const q = search.trim().toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [templates, search]);

  async function handleAdopt() {
    if (!selectedId || adopting) return;
    setAdopting(true);
    try {
      const res = await fetch(`/api/flows/${selectedId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: targetAccountKey }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to add template');
        return;
      }
      toast.success('Template added to your account.');
      onAdopted(payload.flow?.id);
      onClose();
    } finally {
      setAdopting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pick-template-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !adopting && onClose()}
      />
      <div className="relative z-10 w-full max-w-lg flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden max-h-[80vh]">
        <header className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id="pick-template-title"
              className="text-sm font-semibold text-[var(--foreground)] truncate"
            >
              Pick from templates
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate">
              Adopt a published template into your sub-account. You can edit it after.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !adopting && onClose()}
            disabled={adopting}
            title="Close"
            className="w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loadError ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-red-400">{loadError}</p>
            </div>
          ) : templates === null ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-[var(--muted-foreground)]">Loading templates…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Squares2X2Icon className="w-6 h-6 text-[var(--muted-foreground)] mx-auto mb-2" />
              <p className="text-xs text-[var(--muted-foreground)]">
                {templates.length === 0
                  ? 'No published templates yet.'
                  : 'No matches for your search.'}
              </p>
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((tpl) => {
                const isSelected = selectedId === tpl.id;
                return (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(tpl.id)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15'
                          : 'hover:bg-[var(--muted)]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-[var(--primary)] border-[var(--primary)]'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        {isSelected && <CheckIcon className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                        <BoltIcon className="w-5 h-5 text-violet-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">
                          {tpl.name}
                        </p>
                        {tpl.description && (
                          <p className="text-[11px] text-[var(--muted-foreground)] line-clamp-2 mt-0.5">
                            {tpl.description}
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--muted-foreground)] mt-1 tabular-nums">
                          {tpl.nodeCount} step{tpl.nodeCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !adopting && onClose()}
            disabled={adopting}
            className="px-3 h-9 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdopt}
            disabled={!selectedId || adopting}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Squares2X2Icon className="w-3.5 h-3.5" />
            {adopting ? 'Adding…' : 'Add to my account'}
          </button>
        </footer>
      </div>
    </div>
  );
}
