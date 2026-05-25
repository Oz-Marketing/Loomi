'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

/**
 * Top toolbar shared by all Forms detail pages (builder / settings /
 * submissions). Mirrors the email template editor's 3-column grid:
 *
 *   [ Back · status badge · autosave ]   [ Form title ]   [ Open · Publish · ⋮ ]
 *
 * Auto-save lifecycle: the builder page pushes status updates into
 * FormDetailContext on every PATCH; this component reads from context.
 * On settings/submissions the indicator falls back to "Autosave on" since
 * those pages save on blur with their own toast feedback.
 */
export function FormDetailHeader() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { form, setForm, saveStatus, savedAt } = useFormDetail();

  // Title rename — click the centered title to edit. Empty submission
  // reverts to the previous name so the form never ends up nameless.
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(form.name);
  const [publishing, setPublishing] = React.useState(false);

  React.useEffect(() => {
    if (!editingTitle) setTitleDraft(form.name);
  }, [form.name, editingTitle]);

  const commitTitle = async () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (!next || next === form.name) {
      setTitleDraft(form.name);
      return;
    }
    const res = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not rename form.');
      setTitleDraft(form.name);
      return;
    }
    const body = (await res.json()) as { form: typeof form };
    setForm(body.form);
  };

  // Publish toggle — flips draft <-> published. Disabled while a
  // PATCH is in flight so double-clicks don't fire stacked requests.
  const togglePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    const nextStatus = form.status === 'published' ? 'draft' : 'published';
    const res = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    setPublishing(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not update status.');
      return;
    }
    const body = (await res.json()) as { form: typeof form };
    setForm(body.form);
    toast.success(nextStatus === 'published' ? 'Form published.' : 'Form moved to draft.');
  };

  const autoSaveDescriptor = describeSaveStatus(saveStatus, savedAt);
  const published = form.status === 'published';
  const publicUrl = `/f/${form.slug}`;

  return (
    <div className="grid grid-cols-[minmax(260px,1fr)_auto_minmax(260px,1fr)] items-center gap-3 pb-4 flex-shrink-0">
      {/* LEFT — back + status badge + autosave */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => router.push(subHref('/websites/forms'))}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
            published
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
          }`}
        >
          {form.status}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${autoSaveDescriptor.toneClass}`}
        >
          <autoSaveDescriptor.Icon
            className={`w-3.5 h-3.5 ${autoSaveDescriptor.spin ? 'animate-spin' : ''}`}
          />
          <span>{autoSaveDescriptor.label}</span>
        </span>
      </div>

      {/* CENTER — click-to-edit title */}
      <div className="min-w-0 max-w-[720px] justify-self-center">
        <div className="min-w-0 text-center">
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              size={Math.min(Math.max(titleDraft.length || 12, 12), 48)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitTitle();
                else if (e.key === 'Escape') {
                  setTitleDraft(form.name);
                  setEditingTitle(false);
                }
              }}
              onBlur={() => void commitTitle()}
              className="max-w-[min(44rem,64vw)] rounded-xl border border-[var(--primary)] bg-[var(--background)]/80 px-4 py-1.5 text-center text-2xl font-bold text-[var(--foreground)] shadow-[0_0_0_1px_rgba(99,102,241,0.18)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          ) : (
            <h2
              role="button"
              tabIndex={0}
              onClick={() => setEditingTitle(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingTitle(true);
                }
              }}
              title="Click to rename"
              className="text-2xl font-bold capitalize truncate max-w-[40rem] mx-auto cursor-text rounded-md px-3 py-1 hover:bg-[var(--muted)] focus:outline-none focus:bg-[var(--muted)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-colors"
            >
              {form.name || 'Untitled form'}
            </h2>
          )}
          <p className="text-xs text-[var(--muted-foreground)] truncate">/f/{form.slug}</p>
        </div>
      </div>

      {/* RIGHT — open live + ⋮ menu + publish CTA */}
      <div className="flex items-center justify-end gap-2 min-w-0">
        {published && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open live form"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          </a>
        )}
        <MoreMenu formId={form.id} formName={form.name} subHref={subHref} router={router} />
        <button
          type="button"
          onClick={() => void togglePublish()}
          disabled={publishing}
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {published ? 'Move to Draft' : 'Publish'}
        </button>
      </div>
    </div>
  );
}

// ── 3-dot menu ────────────────────────────────────────────────────

function MoreMenu({
  formId,
  formName,
  subHref,
  router,
}: {
  formId: string;
  formName: string;
  subHref: (path: string) => string;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc — small DIY popover (no portal).
  React.useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const deleteCurrentForm = async () => {
    setOpen(false);
    const ok = window.confirm(
      `Delete "${formName || 'Untitled form'}"? This permanently removes the form and its submissions.`,
    );
    if (!ok) return;
    const res = await fetch(`/api/forms/${formId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Delete failed');
      return;
    }
    toast.success('Form deleted.');
    router.push(subHref('/websites/forms'));
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
        title="More actions"
        aria-label="More actions"
      >
        <EllipsisVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] glass-dropdown p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push(subHref(`/websites/forms/${formId}/submissions`));
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            View submissions
            <InboxStackIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          </button>
          <button
            type="button"
            onClick={() => void deleteCurrentForm()}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-md text-rose-300 hover:bg-rose-500/10"
          >
            Delete form
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Save-status descriptor ───────────────────────────────────────

interface SaveDescriptor {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  toneClass: string;
  spin: boolean;
}

function describeSaveStatus(status: string, savedAt: Date | null): SaveDescriptor {
  if (status === 'saving') {
    return {
      label: 'Autosaving…',
      Icon: ArrowPathIcon,
      toneClass: 'text-amber-400',
      spin: true,
    };
  }
  if (status === 'error') {
    return {
      label: 'Save failed',
      Icon: ExclamationTriangleIcon,
      toneClass: 'text-red-400',
      spin: false,
    };
  }
  if (status === 'saved' && savedAt) {
    return {
      label: 'Saved just now',
      Icon: CheckIcon,
      toneClass: 'text-emerald-400',
      spin: false,
    };
  }
  // idle (other pages, or before first save)
  return {
    label: 'Autosave on',
    Icon: ClockIcon,
    toneClass: 'text-[var(--muted-foreground)]',
    spin: false,
  };
}
