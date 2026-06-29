'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ChatBubbleOvalLeftIcon,
  CheckIcon,
  ClipboardDocumentListIcon,
  DocumentIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import type { PacerAd, ActivityEntry, DirectoryUser } from '@/lib/ad-pacer/types';
import {
  PACER_ACTIVITY_MAX_UPLOAD_BYTES,
  AD_STATUS_COLORS,
} from '@/lib/ad-pacer/constants';
import { fmtBytes } from '@/lib/ad-pacer/helpers';
import { PlanAdForm } from './PlanAdForm';
import { Tooltip } from './Tooltip';
import { usePacerReadOnly } from './pacer-read-only';
import { inputClass } from './inputs';

// ─── AdEditorModal stack (ActivityAttachmentPreview + ActivityLogPanel +
//     AdEditorModal). Presentational + callback-driven: the activity
//     add/edit/delete actions (which hit the platform's API) are injected by
//     the parent, so Meta + Google share the modal. ──────────────────────────
export function ActivityAttachmentPreview({ entry }: { entry: ActivityEntry }) {
  if (!entry.attachmentUrl || !entry.attachmentFilename) return null;
  const isImage = !!entry.attachmentMimeType?.startsWith('image/');
  return (
    <div className="mt-2">
      {isImage && (
        <a href={entry.attachmentUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={entry.attachmentUrl}
            alt={entry.attachmentFilename}
            className="max-w-full max-h-48 rounded-md border border-[var(--border)] object-contain bg-[var(--muted)]"
          />
        </a>
      )}
      <a
        href={entry.attachmentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-2 max-w-full text-[11px] text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
      >
        {isImage ? (
          <PhotoIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--primary)]" />
        ) : (
          <DocumentIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--primary)]" />
        )}
        <span className="truncate underline underline-offset-2">
          {entry.attachmentFilename}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
          {fmtBytes(entry.attachmentSize)}
        </span>
      </a>
    </div>
  );
}

function ActivityLogPanel({
  ad,
  users,
  currentUserId,
  onAdd,
  onEdit,
  onDelete,
}: {
  ad: PacerAd;
  users: DirectoryUser[];
  currentUserId: string | null;
  onAdd: (adId: string, text: string, file: File | null) => Promise<void>;
  onEdit: (adId: string, entryId: string, text: string) => Promise<void>;
  onDelete: (adId: string, entryId: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Inline edit: tracks which entry id is in edit mode and the working text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const userById = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (picked.size > PACER_ACTIVITY_MAX_UPLOAD_BYTES) {
      setErrorMsg(
        `File is ${fmtBytes(picked.size)} — exceeds the ${PACER_ACTIVITY_MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
      );
      // Reset the input so the same file can be retried after picking another
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFile(picked);
    setErrorMsg(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAdd = async () => {
    const t = text.trim();
    if ((!t && !file) || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onAdd(ad.id, t, file);
      setText('');
      clearFile();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post entry');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entryId: string, currentText: string) => {
    setEditingId(entryId);
    setEditText(currentText);
    setEditError(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditError(null);
  };
  const saveEdit = async (entryId: string) => {
    const t = editText.trim();
    if (!t || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await onEdit(ad.id, entryId, t);
      cancelEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <aside className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--muted)]/30 min-h-0">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChatBubbleOvalLeftIcon className="w-4 h-4 text-[var(--primary)]" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--foreground)]">
            Updates
          </h3>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {ad.activityLog.length}{' '}
          {ad.activityLog.length === 1 ? 'update' : 'updates'}
        </span>
      </div>

      <div className="themed-scrollbar flex-1 overflow-y-auto p-3 space-y-2">
        {ad.activityLog.length === 0 ? (
          <p className="text-[11px] text-[var(--muted-foreground)] text-center py-6">
            No updates yet. Add a comment, update, or attachment below.
          </p>
        ) : (
          // Chronological order: oldest at top, newest at bottom — same flow
          // as a chat thread. Removed the `.reverse()` that previously put
          // new posts on top.
          ad.activityLog.map((u) => {
            const isMine = !!currentUserId && u.authorUserId === currentUserId;
            const isEditing = editingId === u.id;
            const author = u.authorUserId ? userById.get(u.authorUserId) : null;
            const stamp = new Date(u.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <div
                key={u.id}
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
                      {isMine && u.text && (
                        <Tooltip label="Edit">
                        <button
                          type="button"
                          onClick={() => startEdit(u.id, u.text)}
                          className="text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                          aria-label="Edit update"
                        >
                          <PencilSquareIcon className="w-3.5 h-3.5" />
                        </button>
                        </Tooltip>
                      )}
                      <Tooltip label="Delete">
                      <button
                        type="button"
                        onClick={() => onDelete(ad.id, u.id)}
                        className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                        aria-label="Delete entry"
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
                          saveEdit(u.id);
                        } else if (e.key === 'Escape') {
                          cancelEdit();
                        }
                      }}
                      className={`${inputClass} resize-none leading-relaxed`}
                    />
                    {editError && (
                      <p className="text-[10px] text-red-400">{editError}</p>
                    )}
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
                        onClick={() => saveEdit(u.id)}
                        disabled={editSaving || !editText.trim()}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <CheckIcon className="w-3 h-3" />
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  u.text && (
                    <p className="m-0 text-xs leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">
                      {u.text}
                    </p>
                  )
                )}
                {!isEditing && <ActivityAttachmentPreview entry={u} />}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[var(--border)] bg-[var(--card)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment or log an update…"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd();
          }}
          className={`${inputClass} resize-none leading-relaxed mb-2`}
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFilePick}
        />

        {file && (
          <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]">
            <div className="flex items-center gap-2 min-w-0">
              <PaperClipIcon className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
              <span className="text-[11px] text-[var(--foreground)] truncate">
                {file.name}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
                {fmtBytes(file.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors flex-shrink-0"
              aria-label="Remove attachment"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {errorMsg && (
          <p className="mb-2 text-[10px] text-red-400">{errorMsg}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <Tooltip
              label={`Attach a file (max ${PACER_ACTIVITY_MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`}
            >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <PaperClipIcon className="w-3 h-3" />
              Attach
            </button>
            </Tooltip>
            <span>⌘/Ctrl+Enter to post</span>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || (!text.trim() && !file)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium hover:bg-[var(--primary)]/20 transition-colors disabled:opacity-50"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Post
          </button>
        </div>
      </div>
    </aside>
  );
}


// ─── Ad Editor Modal — full-screen modal wrapping PlanAdForm ───────────────
/**
 * Editor modal with a local draft. Form edits stay in the modal until the
 * user clicks Save; Cancel/X with no changes closes immediately, with
 * changes prompts to discard. The parent autosave is paused while this
 * modal is mounted so debounced PUTs don't fire on transient draft state.
 *
 * `mode='create'` means the ad isn't in the plan yet — Save appends it.
 * `mode='edit'` means it's an existing ad — Save replaces it in place.
 */
export function AdEditorModal({
  initialAd,
  markup,
  liveActivityLog,
  mode,
  users,
  currentUserId,
  onSave,
  onCancel,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
  platform = 'meta',
  editorExtraFields,
}: {
  initialAd: PacerAd;
  /** §0.1 resolved per-account markup factor, threaded to PlanAdForm. */
  markup: number | null;
  /**
   * The current activity log for this ad pulled from the parent plan. The
   * modal's draft state is for form fields only — activity entries persist
   * immediately and need to read live data so newly posted/edited/deleted
   * entries appear without closing the modal.
   */
  liveActivityLog?: ActivityEntry[];
  mode: 'create' | 'edit';
  users: DirectoryUser[];
  currentUserId: string | null;
  onSave: (ad: PacerAd) => void;
  onCancel: () => void;
  onAddActivity: (adId: string, text: string, file: File | null) => Promise<void>;
  onEditActivity: (adId: string, entryId: string, text: string) => Promise<void>;
  onDeleteActivity: (adId: string, entryId: string) => Promise<void>;
  /** Forwarded to PlanAdForm — 'google' hides the Meta creative-workflow fields. */
  platform?: 'meta' | 'google';
  /** Forwarded to PlanAdForm's Ad Details grid (Google passes its Channel picker). */
  editorExtraFields?: (ad: PacerAd, onUpdate: (ad: PacerAd) => void) => ReactNode;
}) {
  const readOnly = usePacerReadOnly();
  const [draft, setDraft] = useState<PacerAd>(initialAd);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Reset draft if the parent swaps in a different ad while the modal is
  // mounted (e.g. opens a different row). Cheap stringify is enough since
  // PacerAd is plain data with no functions.
  const initialKey = initialAd.id;
  useEffect(() => {
    setDraft(initialAd);
    setEditingTitle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialAd),
    [draft, initialAd],
  );

  const tryClose = () => {
    if (
      isDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes?')
    ) {
      return;
    }
    onCancel();
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') tryClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // tryClose is recreated each render; rebinding is fine and cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, initialAd]);

  if (typeof document === 'undefined') return null;

  const accentColor = AD_STATUS_COLORS[draft.adStatus]?.[1] ?? 'var(--border)';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-stretch justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={tryClose}
      />
      <div className="glass-modal relative my-6 mx-4 w-full max-w-6xl rounded-2xl flex flex-col overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: accentColor }}
        />
        {/* Modal header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <ClipboardDocumentListIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTitle(false);
                    }
                  }}
                  placeholder="New Ad"
                  className="w-full bg-transparent text-xl font-bold text-[var(--foreground)] focus:outline-none border-b border-[var(--primary)] py-0.5"
                />
              ) : (
                <Tooltip
                  label={readOnly ? draft.name?.trim() || 'New Ad' : 'Click to edit ad name'}
                  placement="bottom"
                >
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  disabled={readOnly}
                  className="group/title inline-flex items-center gap-2 text-xl font-bold text-[var(--foreground)] truncate max-w-full hover:text-[var(--primary)] transition-colors text-left disabled:hover:text-[var(--foreground)] disabled:cursor-default"
                >
                  <span className="truncate">
                    {draft.name?.trim() || 'New Ad'}
                  </span>
                  {!readOnly && (
                    <PencilSquareIcon className="w-4 h-4 flex-shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity text-[var(--muted-foreground)]" />
                  )}
                </button>
                </Tooltip>
              )}
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {mode === 'create'
                  ? 'Cancel discards this ad. Save adds it to the plan.'
                  : isDirty
                    ? 'Unsaved changes — Save to commit, Cancel to discard.'
                    : 'Click the title to rename.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={tryClose}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onSave(draft)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white text-xs font-medium hover:bg-[var(--primary)] transition-colors"
              >
                Save
              </button>
            )}
            <button
              type="button"
              onClick={tryClose}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              aria-label="Close"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal body — form on the left, activity log on the right */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_340px]">
          <div className="themed-scrollbar overflow-y-auto p-5">
            {/* A disabled fieldset (display:contents → no layout change)
                locks every form control at once when the month is frozen. */}
            <fieldset disabled={readOnly} className="contents">
              <PlanAdForm
                ad={draft}
                users={users}
                onUpdate={setDraft}
                markup={markup}
                platform={platform}
                extraDetailFields={editorExtraFields}
              />
            </fieldset>
          </div>
          {mode === 'create' ? (
            <aside className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--muted)]/30 p-6 text-center justify-center">
              <ChatBubbleOvalLeftIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2" />
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Activity log unlocks once the ad is saved. Click <b>Save</b> to add
                this ad to the plan, then re-open it to leave comments or
                attachments.
              </p>
            </aside>
          ) : (
            <ActivityLogPanel
              // Render with the LIVE activity log (from parent plan) so
              // posts/edits/deletes show up immediately. Form-field draft
              // is unaffected.
              ad={{ ...draft, activityLog: liveActivityLog ?? draft.activityLog }}
              users={users}
              currentUserId={currentUserId}
              onAdd={onAddActivity}
              onEdit={onEditActivity}
              onDelete={onDeleteActivity}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
