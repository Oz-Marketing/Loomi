'use client';

import { useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpTip } from '@/components/ui/help-tip';
import { toast } from '@/lib/toast';
import { REQUEST_TYPES, type RequestType } from '@/lib/drafting/extraction';
import { DRAFT_SLOTS, REQUEST_TYPE_LABELS, type DraftSlot } from '@/lib/drafting/template-slots';

/**
 * "Use for drafted emails": mark a template as the drafting template for one
 * or more request types (docs/email-drafting.md §4.1). The drafter then fills
 * the template's {{draft.*}} slots instead of building its own layout.
 */
export function DraftingTemplateDialog({
  slug,
  name,
  initial,
  initialProblems,
  onClose,
  onSaved,
}: {
  slug: string;
  name: string;
  initial: string[];
  initialProblems: string[];
  onClose: () => void;
  onSaved: (requestTypes: string[], problems: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [problems, setProblems] = useState<string[]>(initialProblems);
  const [saving, setSaving] = useState(false);

  const toggle = (t: RequestType) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setSelected(next);
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/templates/drafting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, requestTypes: [...selected] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; requestTypes?: string[]; problems?: string[] };
      if (!res.ok) {
        toast.error(data.error || "Couldn't save");
        return;
      }
      const types = data.requestTypes ?? [];
      setProblems(data.problems ?? []);
      onSaved(types, data.problems ?? []);
      if ((data.problems ?? []).length) {
        toast.error('Saved, but the template needs its slots before the drafter can use it');
        return;
      }
      toast.success(types.length ? 'Drafted emails will use this template' : 'No longer used for drafted emails');
      onClose();
    } catch {
      toast.error("Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal animate-modal-in flex max-h-[85vh] w-[520px] max-w-[calc(100vw-2rem)] flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-base font-semibold">Use “{name}” for drafted emails</h3>
            <HelpTip title="Drafting templates">
              <p>
                When Loomi drafts an email from approved creative, it uses this template&rsquo;s layout for the
                request types you pick, and fills its slots. Type a slot into a block in the editor:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {(Object.keys(DRAFT_SLOTS) as DraftSlot[]).map((k) => (
                  <li key={k}>
                    <code>{DRAFT_SLOTS[k].token}</code> in {DRAFT_SLOTS[k].where}: {DRAFT_SLOTS[k].what}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                The hero and body slots are required. A template that can&rsquo;t take a draft, or breaks a brand rule
                for a store, falls back to the built-in layout, and the draft says why.
              </p>
            </HelpTip>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Request types</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {REQUEST_TYPES.map((t) => (
                <div key={t}>
                  <Checkbox checked={selected.has(t)} onChange={() => toggle(t)} label={<span className="text-sm">{REQUEST_TYPE_LABELS[t]}</span>} />
                </div>
              ))}
            </div>
          </div>

          {problems.length > 0 && (
            <div className="animate-fade-in-up rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                <ExclamationTriangleIcon className="h-4 w-4" />
                Until this is fixed, drafts use the built-in layout
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-[var(--muted-foreground)]">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--muted)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
