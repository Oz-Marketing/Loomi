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
  Cog6ToothIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

/**
 * Top toolbar for the form builder workspace. Borrows the email
 * template editor's 3-column grid:
 *
 *   [ Back · status badge · autosave ]   [ Form title ]   [ Open · ⚙ · Publish ]
 *
 * Back goes to the form's overview page (not the list) so users
 * exit into the same context they came from. The cog navigates to
 * the settings page — there's no in-builder settings panel; settings
 * is its own route.
 */
export function FormDetailHeader() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { form, setForm, saveStatus, savedAt, openSettings } = useFormDetail();

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
      {/* LEFT — back · status · autosave */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => router.push(subHref(`/websites/forms/${form.id}`))}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Back to overview"
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
          {/* <p className="text-xs text-[var(--muted-foreground)] truncate">/f/{form.slug}</p> */}
        </div>
      </div>

      {/* RIGHT — open live · settings cog · publish */}
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
        <button
          type="button"
          onClick={openSettings}
          title="Form settings"
          aria-label="Form settings"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
        >
          <Cog6ToothIcon className="w-4 h-4" />
        </button>
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
  return {
    label: 'Autosave on',
    Icon: ClockIcon,
    toneClass: 'text-[var(--muted-foreground)]',
    spin: false,
  };
}
