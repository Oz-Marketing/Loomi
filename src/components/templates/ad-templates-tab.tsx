'use client';

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  PlusIcon,
  SparklesIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  PencilSquareIcon,
  PencilIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { UserAvatar } from '@/components/user-avatar';
import PrimaryButton from '@/components/primary-button';
import { TemplatesHeaderActionsContext } from '@/app/email/templates/email-templates-view';
import { AdPreviewThumb, brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import { templateInIndustry } from '@/lib/ad-generator/industry';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

type DocTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
  doc: TemplateDoc | null;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Ads tab of the unified /templates page — the shared library of reusable ad
 * templates (the master layouts). Admins+ manage a template here (View / Edit /
 * Rename / Clone / Delete via a row menu); the per-ad copy is made + edited in
 * the Ad Generator, exactly like email: library templates here, the account's
 * instances there.
 */
export function AdTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const { accountData } = useAccount();
  const { confirm } = useLoomiDialog();
  const headerSlot = useContext(TemplatesHeaderActionsContext);

  const { data, isLoading, error, mutate } = useSWR<{ templates?: DocTemplate[] }>(
    '/api/ad-generator/templates-doc?all=1',
    fetcher,
  );
  // Scope to the active account's industry — in a subaccount you only see its
  // industry's templates; in Admin (no account) you manage the whole library.
  const templates = useMemo(
    () =>
      (data?.templates ?? [])
        .filter((t) => t.doc)
        .filter((t) => templateInIndustry({ industries: t.doc!.industries, fields: t.doc!.fields }, accountData?.category)),
    [data, accountData?.category],
  );
  const branding = useMemo(() => brandingFromAccount(accountData), [accountData]);

  const acct = accountKey ? `&account=${encodeURIComponent(accountKey)}` : '';
  const newAcct = accountKey ? `?account=${encodeURIComponent(accountKey)}` : '';

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocTemplate | null>(null);
  const [renameFor, setRenameFor] = useState<DocTemplate | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuFor]);

  const edit = (id: string) => router.push(`/ad-generator/builder?template=${encodeURIComponent(id)}${acct}`);
  const newTemplate = () => router.push(`/ad-generator/builder${newAcct}`);

  const clone = async (t: DocTemplate) => {
    if (!t.doc) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${t.name} (copy)`, description: t.description ?? undefined, doc: t.doc, status: 'draft' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Cloned "${t.name}"`);
      await mutate();
    } catch (err) {
      toast.error(`Couldn't clone: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!renameFor) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${renameFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Renamed');
      setRenameFor(null);
      await mutate();
    } catch (err) {
      toast.error(`Couldn't rename: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: DocTemplate) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${t.name}" will be permanently removed from the library. Ads already created from it keep their own copy.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Template deleted');
      await mutate();
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  if (error) {
    return <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">Ad templates could not be loaded.</div>;
  }
  if (isLoading) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>;
  }

  const MENU: { key: string; label: string; icon: typeof EyeIcon; run: (t: DocTemplate) => void; danger?: boolean }[] = [
    { key: 'view', label: 'View', icon: EyeIcon, run: (t) => setPreview(t) },
    { key: 'edit', label: 'Edit', icon: PencilSquareIcon, run: (t) => edit(t.id) },
    { key: 'rename', label: 'Rename', icon: PencilIcon, run: (t) => { setRenameFor(t); setRenameValue(t.name); } },
    { key: 'clone', label: 'Clone', icon: DocumentDuplicateIcon, run: (t) => void clone(t) },
    { key: 'delete', label: 'Delete', icon: TrashIcon, run: (t) => void remove(t), danger: true },
  ];

  return (
    <>
      {/* Primary CTA in the page header (portaled), matching the Email tab. */}
      {headerSlot &&
        createPortal(
          <PrimaryButton onClick={newTemplate}>
            <PlusIcon className="w-4 h-4" />
            New template
          </PrimaryButton>,
          headerSlot,
        )}

      {templates.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No ad templates yet</h2>
          <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
            Design a reusable layout in the Template Builder — your team starts each ad from one of these.
          </p>
          <button
            type="button"
            onClick={newTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            New template
          </button>
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {templates.map((t) => {
          const template = t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => edit(t.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && edit(t.id)}
              className="glass-card group relative cursor-pointer rounded-2xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)]"
            >
              <div className="overflow-hidden rounded-t-2xl">
                <AdPreviewThumb template={template} data={t.doc?.defaults ?? {}} branding={branding} height={150} />
              </div>

              {/* Row menu */}
              <div className="absolute right-2 top-2" ref={menuFor === t.id ? menuRef : undefined}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor((cur) => (cur === t.id ? null : t.id));
                  }}
                  title="Actions"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card-strong)]/90 text-[var(--muted-foreground)] backdrop-blur transition-colors hover:text-[var(--foreground)]"
                >
                  <EllipsisVerticalIcon className="h-4 w-4" />
                </button>
                {menuFor === t.id && (
                  <div className="absolute right-0 top-full mt-1 z-30 w-40 glass-dropdown" onClick={(e) => e.stopPropagation()}>
                    {MENU.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setMenuFor(null);
                          m.run(t);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)] ${
                          m.danger ? 'text-red-500' : 'text-[var(--foreground)]'
                        }`}
                      >
                        <m.icon className="h-4 w-4" />
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">{t.name}</div>
                    <span
                      className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                        t.status === 'published' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
                {/* Author — full name + avatar, like email template cards */}
                <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border)] pt-2">
                  <UserAvatar name={t.createdByName} email={t.createdByEmail} avatarUrl={t.createdByImage} size={20} />
                  <span className="truncate text-[11px] text-[var(--muted-foreground)]">
                    {t.createdByName || 'Someone'} · {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* View preview */}
      {preview && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[var(--foreground)]">{preview.name}</div>
                {preview.description && <div className="truncate text-xs text-[var(--muted-foreground)]">{preview.description}</div>}
              </div>
              <button onClick={() => setPreview(null)} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <AdPreviewThumb template={preview.doc ? adTemplateFromDoc(preview.id, preview.doc) : undefined} data={preview.doc?.defaults ?? {}} branding={branding} height={320} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { const t = preview; setPreview(null); edit(t.id); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 h-9 text-sm font-medium text-white hover:bg-[var(--primary)]/90"
              >
                <PencilSquareIcon className="h-4 w-4" />
                Edit
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Rename */}
      {renameFor && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-24" onClick={() => !busy && setRenameFor(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-sm font-bold text-[var(--foreground)]">Rename template</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename();
                if (e.key === 'Escape') setRenameFor(null);
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setRenameFor(null)} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 h-9 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={doRename} disabled={busy} className="rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 h-9 text-sm font-medium text-white hover:bg-[var(--primary)]/90 disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
