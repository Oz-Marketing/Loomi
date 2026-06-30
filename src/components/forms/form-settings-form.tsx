'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ClipboardIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { HelpTip } from '@/components/ui/help-tip';

interface ContactListOption {
  id: string;
  name: string;
  accountKey: string;
  memberCount?: number;
}

function publicHost(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://studio.loomilm.com').replace(/\/+$/, '');
}

export function FormSettingsForm() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { form, setForm } = useFormDetail();
  const [draft, setDraft] = React.useState({
    name: form.name,
    slug: form.slug,
    status: form.status,
    redirectUrl: form.redirectUrl,
    successMessage: form.successMessage,
    leadSource: form.leadSource,
    listId: form.listId,
    forwardToCrm: form.forwardToCrm,
  });
  const [lists, setLists] = React.useState<ContactListOption[]>([]);
  const [saving, setSaving] = React.useState<string | null>(null);
  // Tracks which copy button was last clicked so each shows its own
  // momentary "Copied" feedback. `null` = no recent copy.
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft({
      name: form.name,
      slug: form.slug,
      status: form.status,
      redirectUrl: form.redirectUrl,
      successMessage: form.successMessage,
      leadSource: form.leadSource,
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
        name: form.name,
        slug: form.slug,
        status: form.status,
        redirectUrl: form.redirectUrl,
        successMessage: form.successMessage,
        leadSource: form.leadSource,
        listId: form.listId,
        forwardToCrm: form.forwardToCrm,
      });
      return;
    }
    setForm(payload.form);
    if (key === 'slug' && payload.form.slug !== value) {
      toast.success(`Slug adjusted to ${payload.form.slug} to keep it unique.`);
    } else {
      toast.success('Form settings saved.');
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard blocked — textareas are selectable as a manual fallback.
    }
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

  const previewUrl = `${publicHost()}/f/${draft.slug || form.slug}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="glass-card rounded-2xl p-5">
            <h2 className="text-lg font-semibold">Basics</h2>
            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium">Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  onBlur={() => {
                    if (draft.name.trim() && draft.name !== form.name) void patch('name', draft.name);
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium">Slug</span>
                <input
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                  onBlur={() => {
                    if (draft.slug.trim() && draft.slug !== form.slug) void patch('slug', draft.slug);
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
                <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                  Live preview: {previewUrl}
                </span>
              </label>

              <label className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-3">
                <span>
                  <span className="block text-sm font-medium">Status</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Draft forms will return 404 on the public URL.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.status === 'published'}
                  onClick={() => {
                    const status = draft.status === 'published' ? 'draft' : 'published';
                    setDraft((d) => ({ ...d, status }));
                    void patch('status', status);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    draft.status === 'published'
                      ? 'bg-green-500'
                      : 'bg-[var(--muted)] border border-[var(--border)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      draft.status === 'published' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>
          </section>

          <section className="glass-card rounded-2xl p-5">
            <h2 className="text-lg font-semibold">Submission Behavior</h2>
            <div className="mt-4 grid gap-4">
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
                <span className="text-sm font-medium">Lead source</span>
                <input
                  value={draft.leadSource}
                  onChange={(e) => setDraft((d) => ({ ...d, leadSource: e.target.value }))}
                  onBlur={() => {
                    if (draft.leadSource !== form.leadSource) void patch('leadSource', draft.leadSource);
                  }}
                  placeholder={`Loomi - ${form.name}`}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
                <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                  Stamped on each lead&apos;s source. Leave blank to use{' '}
                  <span className="font-mono">Loomi - {form.name}</span>.
                </span>
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
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="glass-card rounded-2xl p-5 space-y-5">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-semibold">Embed</h2>
                <HelpTip title="How to embed this form">
                  <p>
                    Pick the snippet that fits the page you&rsquo;re embedding
                    on, then paste it into your site&rsquo;s HTML wherever you
                    want the form to appear.
                  </p>
                  <ol>
                    <li>
                      <strong>Script tag</strong> (recommended) — auto-resizes
                      to fit the form&rsquo;s content. Works on most sites.
                    </li>
                    <li>
                      <strong>Iframe</strong> — fixed height. Use when the host
                      page strips <code>&lt;script&gt;</code> tags. Adjust{' '}
                      <code>height</code> if your form is taller or shorter
                      than 600px.
                    </li>
                    <li>
                      <strong>Direct link</strong> — share the hosted form URL
                      anywhere a link works (email, SMS, socials).
                    </li>
                  </ol>
                  <p>
                    In your page editor, add an HTML / embed block and paste
                    the snippet in. Most builders (Webflow, WordPress, Wix,
                    Framer, plain HTML) accept these directly.
                  </p>
                  <p>
                    The form must be <strong>Published</strong> for visitors to
                    submit — draft forms return a 404 on the public URL.
                    Submissions appear under the <strong>Submissions</strong>{' '}
                    tab on this form.
                  </p>
                </HelpTip>
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Pick the snippet that fits the page you&apos;re embedding on.
                Drop it anywhere in the page&apos;s HTML.
              </p>
            </div>

            {/* Script tag — the recommended embed. Renders inline, auto-resizes. */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">Script tag</span>
                  <span className="rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--primary)]">
                    Recommended
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('script', form.embedSnippets.script)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
                >
                  <ClipboardIcon className="w-3.5 h-3.5" />
                  {copied === 'script' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                readOnly
                value={form.embedSnippets.script}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-xs text-[var(--muted-foreground)] resize-none"
              />
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                Auto-resizes to fit your form&apos;s content. Best on most sites.
              </p>
            </div>

            {/* Iframe — the fallback for environments that strip <script>. */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-sm font-semibold">Iframe (fixed height)</span>
                <button
                  type="button"
                  onClick={() => copyText('iframe', form.embedSnippets.iframe)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
                >
                  <ClipboardIcon className="w-3.5 h-3.5" />
                  {copied === 'iframe' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                readOnly
                value={form.embedSnippets.iframe}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-xs text-[var(--muted-foreground)] resize-none"
              />
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                Use when the host page strips script tags. Edit the
                <code className="mx-1 rounded bg-[var(--muted)] px-1 py-0.5">height</code>
                if your form is taller or shorter than 600px.
              </p>
            </div>

            {/* Direct share link */}
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-sm font-semibold">Direct link</span>
                <button
                  type="button"
                  onClick={() => copyText('url', form.embedSnippets.publicUrl)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
                >
                  <ClipboardIcon className="w-3.5 h-3.5" />
                  {copied === 'url' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <a
                href={form.embedSnippets.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all text-xs font-mono text-[var(--primary)] hover:underline"
              >
                {form.embedSnippets.publicUrl}
              </a>
            </div>
          </section>

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
        </aside>
      </div>
    </div>
  );
}
