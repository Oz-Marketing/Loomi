'use client';

/**
 * Disclaimer template manager (admin) — CRUD over `AdDisclaimerTemplate`.
 * Reusable legal text with {slug} tokens, scoped per (make, offer type). The
 * generator auto-fills the disclaimer from these (make-specific first, then
 * global); when none exist it uses the code-defined defaults. Flag-gated by
 * the /ad-generator layout; admin-only here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftIcon, PlusIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { FontSelect } from '@/components/font-select';
import { OFFER_TYPES } from '@/lib/ad-generator/offer-text';
import { DISCLAIMER_SLUGS } from '@/lib/ad-generator/disclaimer';

interface Template {
  id: string;
  make: string | null;
  offerType: string;
  name: string;
  body: string;
  isDefault: boolean;
  isActive: boolean;
}

interface Draft {
  id?: string;
  make: string;
  offerType: string;
  name: string;
  body: string;
  isDefault: boolean;
  isActive: boolean;
}

const EMPTY: Draft = { make: '', offerType: 'lease', name: '', body: '', isDefault: false, isActive: true };
const OFFER_TYPE_LABEL = Object.fromEntries(OFFER_TYPES.map((o) => [o.value, o.label]));

/** Render body text with `{slug}` tokens as subtle pills, so it's clear which
 *  parts auto-fill from the offer vs. which are fixed legal wording. */
function highlightTokens(text: string) {
  return text.split(/(\{[a-z_]+\})/g).map((part, i) =>
    /^\{[a-z_]+\}$/.test(part) ? (
      <span key={i} className="rounded bg-[var(--primary)]/10 px-1 font-medium text-[var(--primary)]">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function DisclaimerTemplatesPage() {
  const { userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  const [items, setItems] = useState<Template[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ad-generator/disclaimer-templates?all=1');
      const d = res.ok ? await res.json() : { templates: [] };
      setItems(d.templates ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.body.trim()) {
      toast.error('Name and body are required');
      return;
    }
    setSaving(true);
    try {
      const isEdit = Boolean(draft.id);
      const res = await fetch(
        isEdit ? `/api/ad-generator/disclaimer-templates/${draft.id}` : '/api/ad-generator/disclaimer-templates',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(isEdit ? 'Template updated' : 'Template created');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this disclaimer template?')) return;
    try {
      const res = await fetch(`/api/ad-generator/disclaimer-templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Deleted');
      await load();
    } catch {
      toast.error('Could not delete');
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-[var(--muted-foreground)]">
        Disclaimer templates are managed by admins.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/ad-generator"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            aria-label="Back to Ad Generator"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Disclaimer templates</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Reusable legal text with {'{slug}'} tokens, per make + offer type. The generator auto-fills the disclaimer from these; numbers fill from the offer.
            </p>
          </div>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft({ ...EMPTY })}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" /> New template
          </button>
        )}
      </div>

      <div className="mb-6 flex gap-1 text-xs">
        <span className="rounded-md bg-[var(--primary)]/10 px-2.5 py-1 font-medium text-[var(--primary)]">Disclaimer Templates</span>
        <Link href="/ad-generator/oem-rules" className="rounded-md px-2.5 py-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          OEM Rules
        </Link>
      </div>

      {draft && (
        <TemplateForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} />
      )}

      {items === null ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No templates yet — the generator uses the built-in defaults. Add one to override per make / offer type.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} className="glass-card rounded-xl border border-[var(--border)] p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--foreground)]">{t.name}</span>
                  <Badge>{OFFER_TYPE_LABEL[t.offerType] ?? t.offerType}</Badge>
                  <Badge>{t.make || 'Global'}</Badge>
                  {t.isDefault && <Badge tone="primary">Default</Badge>}
                  {!t.isActive && <Badge tone="muted">Inactive</Badge>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={() => setDraft({ ...t, make: t.make ?? '' })}
                    className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    aria-label="Edit"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Delete"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="line-clamp-3 text-xs leading-relaxed text-[var(--muted-foreground)]">{highlightTokens(t.body)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'primary' | 'muted' }) {
  const cls =
    tone === 'primary'
      ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
      : tone === 'muted'
        ? 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        : 'border border-[var(--border)] text-[var(--muted-foreground)]';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

function TemplateForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const input =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Insert a {token} into the body at the cursor (or replacing the selection),
  // then restore focus + cursor right after it — so building a template is
  // click-to-insert instead of remembering + typing slug names.
  const insertToken = (token: string) => {
    const ta = bodyRef.current;
    const cur = draft.body;
    if (!ta) {
      setDraft({ ...draft, body: cur + token });
      return;
    }
    const start = ta.selectionStart ?? cur.length;
    const end = ta.selectionEnd ?? cur.length;
    setDraft({ ...draft, body: cur.slice(0, start) + token + cur.slice(end) });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="glass-card mb-5 rounded-xl border border-[var(--primary)]/30 p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">{draft.id ? 'Edit template' : 'New template'}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Name</label>
          <input className={input} value={draft.name} placeholder="GM APR — co-op compliant" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Make <span className="font-normal text-[var(--muted-foreground)]">— blank = global</span></label>
          <input className={input} value={draft.make} placeholder="Toyota" onChange={(e) => setDraft({ ...draft, make: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Offer type</label>
          <FontSelect value={draft.offerType} onChange={(v) => setDraft({ ...draft, offerType: v })} options={OFFER_TYPES} previewFont={false} />
        </div>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
            Default
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
            Active
          </label>
        </div>
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Body</label>
        <textarea
          ref={bodyRef}
          rows={4}
          className={`${input} resize-y`}
          value={draft.body}
          placeholder="{apr_rate}% APR for {apr_term} months with approved credit. See dealer for details."
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <p className="mb-1.5 mt-2 text-[11px] font-medium text-[var(--muted-foreground)]">
          Click to insert a token <span className="font-normal">— it fills from the offer at render time:</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {Object.keys(DISCLAIMER_SLUGS).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => insertToken(`{${s}}`)}
              title={`Insert {${s}}`}
              className="rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20"
            >
              {`{${s}}`}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create template'}
        </button>
      </div>
    </div>
  );
}
