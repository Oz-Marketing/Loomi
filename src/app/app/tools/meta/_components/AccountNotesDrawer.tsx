'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChatBubbleOvalLeftIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { UserAvatar } from '@/components/user-avatar';
import type { DirectoryUser } from '@/lib/ad-pacer/types';
import { Tooltip, inputClass } from '@/app/app/tools/_shared';

// Account-level notes drawer (Meta-only — own /notes API). Split out of
// MetaAdsPlannerTool; used by the header + the Overview rows.
export interface AccountNote {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
}

export function AccountNotesDrawer({
  accountKey,
  accountLabel,
  period,
  users,
  currentUserId,
  onClose,
  onCountChange,
}: {
  accountKey: string;
  accountLabel: string;
  // Account comments are scoped to the month they're written in — May notes
  // only appear in May, June starts fresh.
  period: string;
  users: DirectoryUser[];
  currentUserId: string | null;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const [notes, setNotes] = useState<AccountNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const userMap = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/notes?period=${period}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ notes: AccountNote[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.notes) ? data.notes : [];
        setNotes(list);
        onCountChange?.(list.length);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period, onCountChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, period }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const note = (await res.json()) as AccountNote;
      setNotes((prev) => {
        const next = [...(prev ?? []), note];
        onCountChange?.(next.length);
        return next;
      });
      setText('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] post failed', err);
      toast.error('Could not post note');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    const prev = notes ?? [];
    // Optimistic update so the row vanishes immediately; rollback on error.
    setNotes(prev.filter((n) => n.id !== noteId));
    onCountChange?.(Math.max(0, prev.length - 1));
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/notes/${noteId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] delete failed', err);
      toast.error('Could not delete note');
      setNotes(prev);
      onCountChange?.(prev.length);
    }
  };

  const startEdit = (noteId: string, currentText: string) => {
    setEditingId(noteId);
    setEditText(currentText);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = async (noteId: string) => {
    const trimmed = editText.trim();
    if (!trimmed || editSaving) return;
    setEditSaving(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/notes/${noteId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as AccountNote;
      setNotes((prev) =>
        (prev ?? []).map((n) => (n.id === noteId ? { ...n, text: updated.text } : n)),
      );
      cancelEdit();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pacer notes] edit failed', err);
      toast.error('Could not save edit');
    } finally {
      setEditSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    // Outer wrapper is a transparent click-target only — no background dim
    // and no backdrop blur, so the rest of the page stays fully visible
    // and usable while the drawer is open (matches the page-content-first
    // feel the user wants for the notes log).
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="frost-heavy fixed right-3 top-3 bottom-3 w-[420px] max-w-[calc(100vw-1.5rem)] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <ChatBubbleOvalLeftIcon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Notes — {accountLabel}</span>
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Account-level chat log. Visible to anyone with pacer access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex-shrink-0"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar px-4 py-3">
          {error ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Could not load notes: {error}
            </div>
          ) : notes == null ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Loading…
            </div>
          ) : notes.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">
              No notes yet. Add the first one below.
            </div>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0">
              {notes.map((note) => {
                const isMine =
                  !!currentUserId && note.authorUserId === currentUserId;
                const isEditing = editingId === note.id;
                const author = note.authorUserId
                  ? userMap.get(note.authorUserId)
                  : null;
                const stamp = new Date(note.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                return (
                  <li
                    key={note.id}
                    className={`rounded-lg border px-3 py-2 ${
                      isMine
                        ? 'border-[var(--primary)]/40 bg-[var(--primary)]/12'
                        : 'border-[var(--border)] bg-[var(--card)]'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1.5 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {author && (
                          <UserAvatar
                            name={author.name}
                            email={author.email}
                            avatarUrl={author.avatarUrl}
                            size={28}
                            className={`w-7 h-7 rounded-full object-cover flex-shrink-0 border ${
                              isMine
                                ? 'border-[var(--primary)]/60'
                                : 'border-[var(--border)]'
                            }`}
                          />
                        )}
                        <div className="flex flex-col min-w-0 leading-tight">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isMine ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                            }`}
                          >
                            {author?.name ?? 'Unknown'}
                          </span>
                          <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                            {stamp}
                          </span>
                        </div>
                      </div>
                      {!isEditing && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isMine && (
                            <Tooltip label="Edit">
                            <button
                              type="button"
                              onClick={() => startEdit(note.id, note.text)}
                              className="text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                              aria-label="Edit note"
                            >
                              <PencilSquareIcon className="w-3.5 h-3.5" />
                            </button>
                            </Tooltip>
                          )}
                          <Tooltip label="Delete">
                          <button
                            type="button"
                            onClick={() => handleDelete(note.id)}
                            className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                            aria-label="Delete note"
                          >
                            <TrashIcon className="w-3 h-3" />
                          </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              saveEdit(note.id);
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                          className={`${inputClass} resize-none leading-relaxed`}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={editSaving}
                            className="px-2 py-1 text-[10px] font-medium rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(note.id)}
                            disabled={editSaving || !editText.trim()}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <CheckIcon className="w-3 h-3" />
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="m-0 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
                        {note.text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3 flex-shrink-0">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handlePost();
              }
            }}
            placeholder="Add a note… (⌘/Ctrl+Enter to post)"
            rows={3}
            className={`${inputClass} w-full resize-none text-xs`}
          />
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {text.trim().length > 0 ? `${text.trim().length} characters` : ''}
            </span>
            <button
              type="button"
              onClick={handlePost}
              disabled={!text.trim() || posting}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
