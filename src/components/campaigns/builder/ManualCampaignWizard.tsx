'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { SMS_MAX_CHARS } from '@/lib/campaigns/types';

type ManualItem =
  | { localId: string; kind: 'email'; subject: string; previewText: string; bodyText: string }
  | { localId: string; kind: 'sms'; message: string };

const inputCls =
  'w-full rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]/60';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `${Math.round(performance.now())}`;
}

export function ManualCampaignWizard() {
  const router = useRouter();
  const href = useSubaccountHref();
  const { accountKey, accounts, accountsLoaded, setAccount } = useAccount();

  const [needsAccount, setNeedsAccount] = useState(false);
  const [name, setName] = useState('');
  const [items, setItems] = useState<ManualItem[]>([
    { localId: uid(), kind: 'email', subject: '', previewText: '', bodyText: '' },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !accountsLoaded) return;
    initRef.current = true;
    if (!accountKey) setNeedsAccount(true);
  }, [accountsLoaded, accountKey]);

  const addEmail = () =>
    setItems((prev) => [...prev, { localId: uid(), kind: 'email', subject: '', previewText: '', bodyText: '' }]);
  const addSms = () => setItems((prev) => [...prev, { localId: uid(), kind: 'sms', message: '' }]);
  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.localId !== id));
  const patch = (id: string, p: Partial<ManualItem>) =>
    setItems((prev) => prev.map((i) => (i.localId === id ? ({ ...i, ...p } as ManualItem) : i)));

  const canCreate =
    !!name.trim() &&
    !!accountKey &&
    items.length > 0 &&
    items.every((i) => (i.kind === 'email' ? i.subject.trim() : i.message.trim()));

  const handleCreate = async () => {
    if (!accountKey || !canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountKey }),
      });
      const data = await res.json();
      if (!res.ok || !data?.campaign) throw new Error(data?.error || 'Failed to create campaign');
      const id = data.campaign.id as string;

      for (const item of items) {
        const body =
          item.kind === 'email'
            ? { kind: 'email', subject: item.subject, previewText: item.previewText, bodyText: item.bodyText }
            : { kind: 'sms', message: item.message };
        await fetch(`/api/campaigns/${id}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }

      router.push(href(`/campaign-builder/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setCreating(false);
    }
  };

  return (
    <div className="animate-fade-in-up mx-auto max-w-2xl">
      <Link
        href={href('/campaign-builder')}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Campaigns
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Build a campaign manually</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Add your emails and texts. Everything is saved as a draft — you’ll pick recipients and send from each one.
        </p>
      </header>

      {needsAccount && (
        <div className="mb-6">
          <label className={labelCls}>Account</label>
          <select
            className={inputCls}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                setAccount({ mode: 'account', accountKey: e.target.value });
                setNeedsAccount(false);
              }
            }}
          >
            <option value="" disabled>
              Select an account…
            </option>
            {Object.entries(accounts).map(([key, data]) => (
              <option key={key} value={key}>
                {data.dealer}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-6">
        <label className={labelCls}>Campaign name</label>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Memorial Day Service Sale"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={item.localId} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                {item.kind === 'email' ? (
                  <EnvelopeIcon className="h-4 w-4 text-sky-400" />
                ) : (
                  <ChatBubbleLeftRightIcon className="h-4 w-4 text-emerald-400" />
                )}
                {item.kind === 'email' ? 'Email' : 'Text message'} {i + 1}
              </span>
              {items.length > 1 && (
                <button onClick={() => remove(item.localId)} className="text-[var(--muted-foreground)] transition hover:text-rose-400">
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>

            {item.kind === 'email' ? (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Subject</label>
                  <input className={inputCls} value={item.subject} onChange={(e) => patch(item.localId, { subject: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Preview text (optional)</label>
                  <input className={inputCls} value={item.previewText} onChange={(e) => patch(item.localId, { previewText: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Body</label>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={5}
                    value={item.bodyText}
                    onChange={(e) => patch(item.localId, { bodyText: e.target.value })}
                    placeholder="Write the email body — blank lines start new paragraphs. You can refine the design in the editor afterward."
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className={labelCls}>Message</label>
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={3}
                  maxLength={SMS_MAX_CHARS}
                  value={item.message}
                  onChange={(e) => patch(item.localId, { message: e.target.value })}
                  placeholder="Keep it short. Add an opt-out like “Txt STOP to opt out.”"
                />
                <p className="mt-1 text-right text-[10px] text-[var(--muted-foreground)]">
                  {item.message.length}/{SMS_MAX_CHARS}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={addEmail} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]">
          <PlusIcon className="h-3.5 w-3.5" /> Add email
        </button>
        <button onClick={addSms} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]">
          <PlusIcon className="h-3.5 w-3.5" /> Add SMS
        </button>
      </div>

      <div className="mt-8 flex items-center justify-end">
        <button
          onClick={handleCreate}
          disabled={!canCreate || creating}
          className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create campaign'}
        </button>
      </div>
    </div>
  );
}
