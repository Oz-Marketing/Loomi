'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface ContactListOption {
  id: string;
  name: string;
  accountKey: string;
  memberCount?: number;
}

/**
 * Form Settings tab — submission behavior only. Name, slug, and embed
 * snippets live elsewhere (name/slug are edited inline in the overview
 * header; embed is the header's "Embed" button), so this tab is a single
 * section plus the danger zone.
 */
export function FormSettingsForm() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { form, setForm } = useFormDetail();
  const [draft, setDraft] = React.useState({
    redirectUrl: form.redirectUrl,
    successMessage: form.successMessage,
    leadSource: form.leadSource,
    notificationEmail: form.notificationEmail,
    listId: form.listId,
    forwardToCrm: form.forwardToCrm,
  });
  const [lists, setLists] = React.useState<ContactListOption[]>([]);
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft({
      redirectUrl: form.redirectUrl,
      successMessage: form.successMessage,
      leadSource: form.leadSource,
      notificationEmail: form.notificationEmail,
      listId: form.listId,
      forwardToCrm: form.forwardToCrm,
    });
  }, [form]);

  React.useEffect(() => {
    fetch('/api/contacts/lists')
      .then((res) => (res.ok ? res.json() : { lists: [] }))
      .then((payload) => {
        const rows = Array.isArray(payload?.lists) ? payload.lists : [];
        setLists(rows.filter((row: ContactListOption) => row.accountKey === form.accountKey));
      })
      .catch(() => setLists([]));
  }, [form.accountKey]);

  async function patch(key: string, value: unknown) {
    setSaving(key);
    const res = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) {
      toast.error(payload.error || 'Update failed');
      setDraft({
        redirectUrl: form.redirectUrl,
        successMessage: form.successMessage,
        leadSource: form.leadSource,
        notificationEmail: form.notificationEmail,
        listId: form.listId,
        forwardToCrm: form.forwardToCrm,
      });
      return;
    }
    setForm(payload.form);
    toast.success('Form settings saved.');
  }

  async function deleteCurrentForm() {
    const ok = window.confirm(
      `Delete "${form.name || 'Untitled form'}"? This permanently removes the form and its submissions.`,
    );
    if (!ok) return;
    const res = await fetch(`/api/forms/${form.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Delete failed');
      return;
    }
    toast.success('Form deleted.');
    router.push(subHref('/websites/forms'));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <section className="glass-card rounded-2xl p-5">
        <h2 className="mb-4 text-lg font-semibold">Submission Behavior</h2>
        <div className="grid gap-4">
          <label className="block">
            <span className="text-sm font-medium">Redirect URL</span>
            <input
              value={draft.redirectUrl}
              onChange={(e) => setDraft((d) => ({ ...d, redirectUrl: e.target.value }))}
              onBlur={() => {
                if (draft.redirectUrl !== form.redirectUrl) void patch('redirectUrl', draft.redirectUrl);
              }}
              placeholder="https://example.com/thank-you"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Success message</span>
            <textarea
              value={draft.successMessage}
              onChange={(e) => setDraft((d) => ({ ...d, successMessage: e.target.value }))}
              onBlur={() => {
                if (draft.successMessage !== form.successMessage) {
                  void patch('successMessage', draft.successMessage);
                }
              }}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Attach to list</span>
            <select
              value={draft.listId}
              onChange={(e) => {
                const listId = e.target.value;
                setDraft((d) => ({ ...d, listId }));
                void patch('listId', listId || null);
              }}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            >
              <option value="">None</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                  {typeof list.memberCount === 'number' ? ` (${list.memberCount})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-3">
            <span>
              <span className="block text-sm font-medium">Forward leads to CRM</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                Send each submission to this account&apos;s CRM (Tekion / VinSolutions). Off
                keeps leads in Loomi only. Configure the destination in the account&apos;s
                Integrations settings.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.forwardToCrm}
              onClick={() => {
                const next = !draft.forwardToCrm;
                setDraft((d) => ({ ...d, forwardToCrm: next }));
                void patch('forwardToCrm', next);
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                draft.forwardToCrm
                  ? 'bg-green-500'
                  : 'bg-[var(--muted)] border border-[var(--border)]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  draft.forwardToCrm ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Lead notification email</span>
            <input
              type="text"
              value={draft.notificationEmail}
              onChange={(e) => setDraft((d) => ({ ...d, notificationEmail: e.target.value }))}
              onBlur={() => {
                if (draft.notificationEmail !== form.notificationEmail) {
                  void patch('notificationEmail', draft.notificationEmail);
                }
              }}
              placeholder="sales@example.com, manager@example.com"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            />
            <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
              Sends an email here every time this form gets a new submission.
              Separate multiple addresses with commas. Leave blank to disable.
            </span>
          </label>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="mt-0.5 w-5 h-5 text-rose-400" />
          <div>
            <h2 className="font-semibold text-rose-300">Danger zone</h2>
            <p className="mt-1 text-xs text-rose-200/80">
              Deleting a form also deletes its stored submissions.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={deleteCurrentForm}
          className="mt-4 w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20"
        >
          Delete form
        </button>
      </section>

      {saving && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          Saving {saving}...
        </p>
      )}
    </div>
  );
}
