'use client';

/**
 * Shared header actions for every /templates tab — a primary **Create Template**
 * button + a ⋯ overflow menu with **Manage tags**, portaled into the page's
 * sticky-header slot (`TemplatesHeaderActionsContext`). Self-contained: it
 * fetches/saves the shared tag vocabulary (`/api/template-tags`) and hosts the
 * Manage-tags modal, so a tab only supplies `onCreate`.
 *
 * The context lives here (not in the email view) so all tabs + the /templates
 * page can import it without a cycle.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { EllipsisHorizontalIcon, TagIcon, PlusIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { getTagColor } from '@/lib/tag-colors';
import { parseTemplateTagsPayload, assignmentsMapToArray } from '@/lib/template-tags-payload';

/** Slot the /templates sticky header reserves for the active tab's actions. */
export const TemplatesHeaderActionsContext = createContext<HTMLElement | null>(null);

type TagData = { tags: string[]; assignments: Record<string, string[]> };

export function TemplateHeaderActions({
  onCreate,
  createLabel = 'Create Template',
  /** Called after the tag vocabulary is saved, so the tab can refresh its facets. */
  onTagsSaved,
}: {
  onCreate: () => void;
  createLabel?: string;
  onTagsSaved?: () => void;
}) {
  const slot = useContext(TemplatesHeaderActionsContext);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [overflowOpen]);

  const openManageTags = async () => {
    setOverflowOpen(false);
    try {
      const res = await fetch('/api/template-tags');
      setTagData(parseTemplateTagsPayload(await res.json()));
    } catch {
      setTagData({ tags: [], assignments: {} });
    }
    setManageOpen(true);
  };

  const saveTags = async (data: TagData) => {
    try {
      const res = await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: data.tags, assignments: assignmentsMapToArray(data.assignments) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Tags saved');
      setManageOpen(false);
      onTagsSaved?.();
    } catch {
      toast.error('Failed to save tags');
    }
  };

  return (
    <>
      {slot &&
        createPortal(
          <>
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setOverflowOpen((v) => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                title="More actions"
                aria-label="More actions"
              >
                <EllipsisHorizontalIcon className="w-4 h-4" />
              </button>
              {overflowOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
                  <button
                    onClick={() => void openManageTags()}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                  >
                    <TagIcon className="w-4 h-4" />
                    Manage tags
                  </button>
                </div>
              )}
            </div>
            <PrimaryButton onClick={onCreate}>
              <PlusIcon className="w-4 h-4" />
              {createLabel}
            </PrimaryButton>
          </>,
          slot,
        )}
      {manageOpen && <ManageTagsModal tagData={tagData} onSave={saveTags} onClose={() => setManageOpen(false)} />}
    </>
  );
}

function ManageTagsModal({
  tagData,
  onSave,
  onClose,
}: {
  tagData: TagData;
  onSave: (data: TagData) => void;
  onClose: () => void;
}) {
  const { confirm } = useLoomiDialog();
  const [local, setLocal] = useState<TagData>(JSON.parse(JSON.stringify(tagData)));
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');

  const addTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    if (local.tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    setLocal({ ...local, tags: [...local.tags, name] });
    setNewTagName('');
  };

  const renameTag = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setEditingTag(null); return; }
    if (local.tags.some((t) => t !== oldName && t.toLowerCase() === trimmed.toLowerCase())) { setEditingTag(null); return; }
    const newTags = local.tags.map((t) => (t === oldName ? trimmed : t));
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      newAssignments[key] = tags.map((t) => (t === oldName ? trimmed : t));
    }
    setLocal({ tags: newTags, assignments: newAssignments });
    setEditingTag(null);
  };

  const deleteTag = async (tagName: string) => {
    const count = Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;
    if (count > 0) {
      const confirmed = await confirm({
        title: 'Remove Tag',
        message: `Remove "${tagName}" tag from ${count} template${count > 1 ? 's' : ''}?`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;
    }
    const newTags = local.tags.filter((t) => t !== tagName);
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      const filtered = tags.filter((t) => t !== tagName);
      if (filtered.length > 0) newAssignments[key] = filtered;
    }
    setLocal({ tags: newTags, assignments: newAssignments });
  };

  const getTagCount = (tagName: string) =>
    Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal w-[480px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold">Manage Tags</h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">Create, rename, and remove tags.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <div className="space-y-1.5">
              {local.tags.length === 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)] italic py-4 text-center">
                  No tags yet. Create one below or add one inline from a template card.
                </p>
              )}
              {local.tags.map((tag) => {
                const color = getTagColor(tag);
                return (
                  <div key={tag} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                    <span className={`inline-block w-2 h-2 rounded-full ${color.className.split(' ')[0]}`} />
                    {editingTag === tag ? (
                      <input
                        type="text"
                        value={editTagValue}
                        onChange={(e) => setEditTagValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') renameTag(tag, editTagValue); if (e.key === 'Escape') setEditingTag(null); }}
                        onBlur={() => renameTag(tag, editTagValue)}
                        className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--foreground)]"
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium">{tag}</span>
                    )}
                    <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{getTagCount(tag)}</span>
                    <button onClick={() => { setEditingTag(tag); setEditTagValue(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors" title="Rename">
                      <PencilIcon className="w-3 h-3" />
                    </button>
                    <button onClick={() => { void deleteTag(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete tag">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]" placeholder="New tag name..." />
              <PrimaryButton onClick={addTag} disabled={!newTagName.trim()}>Add</PrimaryButton>
            </div>
          </div>

          <p className="text-[11px] text-[var(--muted-foreground)] -mt-1">
            Assign tags to templates directly from the library — click the <span className="inline-flex items-center gap-0.5 text-[var(--muted-foreground)]"><PlusIcon className="w-3 h-3 inline" />tag</span> button on any template card.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors">Cancel</button>
          <PrimaryButton onClick={() => onSave(local)}>Save</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
