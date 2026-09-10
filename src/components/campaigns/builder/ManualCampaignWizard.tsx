'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { SMS_MAX_CHARS, type CampaignAssetKind } from '@/lib/campaigns/types';
import { CHANNEL_META } from './shared';

/**
 * One piece of a hand-built campaign. Email and SMS take their content here;
 * a landing page, form, flow or ad is created blank under the account and
 * finished in its own builder — those tools ARE the editor, and a quick-form
 * for a landing page would be a worse landing-page builder.
 */
type ManualItem =
  | { localId: string; kind: 'email'; subject: string; previewText: string; bodyText: string }
  | { localId: string; kind: 'sms'; message: string }
  | { localId: string; kind: 'landingPage'; name: string }
  | { localId: string; kind: 'form'; name: string }
  | { localId: string; kind: 'flow'; name: string }
  | { localId: string; kind: 'ad'; name: string; templateId: string };

/** The kinds a person can pick, in the order they appear in the grid. */
const ADDABLE: CampaignAssetKind[] = ['email', 'sms', 'landingPage', 'form', 'flow', 'ad'];

/** One line each, so the grid explains itself without a legend. */
const PIECE_BLURB: Record<CampaignAssetKind, string> = {
  email: 'Subject, preview text, and body.',
  sms: 'A short text with an opt-out.',
  landingPage: 'A page you build in the site builder.',
  form: 'A lead form you can embed anywhere.',
  flow: 'An automated email and text drip.',
  ad: 'A copy of a published ad design.',
};

function blank(kind: CampaignAssetKind, localId: string): ManualItem {
  switch (kind) {
    case 'email':
      return { localId, kind, subject: '', previewText: '', bodyText: '' };
    case 'sms':
      return { localId, kind, message: '' };
    case 'ad':
      return { localId, kind, name: '', templateId: '' };
    default:
      return { localId, kind, name: '' };
  }
}

const inputCls =
  'w-full rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]/60';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `${Math.round(performance.now())}`;
}

type Step = 'pieces' | 'details';

export function ManualCampaignWizard() {
  const router = useRouter();
  const href = useSubaccountHref();
  const { accountKey, accounts, accountsLoaded, setAccount } = useAccount();

  const [step, setStep] = useState<Step>('pieces');
  const [needsAccount, setNeedsAccount] = useState(false);
  const [name, setName] = useState('');
  // Empty to start: the grid is the first thing you answer, so nothing is
  // chosen for you. (It used to open with one email whether you wanted one or
  // not, and the only way out was the trash can.)
  const [items, setItems] = useState<ManualItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  // Published ad designs in scope for this account, for the ad piece's picker.
  // Fetched once the account is known; an account with none simply can't add
  // an ad here, and the card says so.
  const [adTemplates, setAdTemplates] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    fetch(`/api/ad-generator/templates-doc?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: { id: string; name: string; status?: string }[] }) => {
        if (cancelled) return;
        setAdTemplates((d.templates ?? []).filter((t) => !t.status || t.status === 'published').map((t) => ({ id: t.id, name: t.name })));
      })
      .catch(() => {
        if (!cancelled) setAdTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  useEffect(() => {
    if (initRef.current || !accountsLoaded) return;
    initRef.current = true;
    if (!accountKey) setNeedsAccount(true);
  }, [accountsLoaded, accountKey]);

  const add = (kind: CampaignAssetKind) => setItems((prev) => [...prev, blank(kind, uid())]);
  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.localId !== id));
  const patch = (id: string, p: Partial<ManualItem>) =>
    setItems((prev) => prev.map((i) => (i.localId === id ? ({ ...i, ...p } as ManualItem) : i)));

  const countOf = (kind: CampaignAssetKind) => items.filter((i) => i.kind === kind).length;
  /** Grid click: off → one of them, on → none of them. */
  const toggleKind = (kind: CampaignAssetKind) =>
    setItems((prev) => (prev.some((i) => i.kind === kind) ? prev.filter((i) => i.kind !== kind) : [...prev, blank(kind, uid())]));
  /** Drop the last one of a kind — the stepper's minus. */
  const removeLastOf = (kind: CampaignAssetKind) =>
    setItems((prev) => {
      const idx = prev.map((i) => i.kind).lastIndexOf(kind);
      return idx < 0 ? prev : prev.filter((_, n) => n !== idx);
    });

  const noAdDesigns = adTemplates !== null && adTemplates.length === 0;

  // Fill-in order follows the grid, not the order you happened to tap.
  const ordered = useMemo(
    () => [...items].sort((a, b) => ADDABLE.indexOf(a.kind) - ADDABLE.indexOf(b.kind)),
    [items],
  );

  const itemValid = (i: ManualItem): boolean => {
    switch (i.kind) {
      case 'email':
        return !!i.subject.trim();
      case 'sms':
        return !!i.message.trim();
      case 'ad':
        return !!i.name.trim() && !!i.templateId;
      default:
        return !!i.name.trim();
    }
  };
  const canContinue = !!name.trim() && !!accountKey && items.length > 0;
  const canCreate = canContinue && items.every(itemValid);

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

      for (const item of ordered) {
        const body =
          item.kind === 'email'
            ? { kind: 'email', subject: item.subject, previewText: item.previewText, bodyText: item.bodyText }
            : item.kind === 'sms'
              ? { kind: 'sms', message: item.message }
              : item.kind === 'ad'
                ? { kind: 'ad', name: item.name, templateId: item.templateId }
                : { kind: item.kind, name: item.name };
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

  const total = items.length;

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
          {step === 'pieces'
            ? 'Name it, then choose the pieces it needs. You can add more later.'
            : 'Fill in what you picked. Everything is saved as a draft you finish in its own builder.'}
        </p>
      </header>

      <StepDots step={step} />

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
          {error}
        </div>
      )}

      {step === 'pieces' ? (
        <div key="pieces" className="animate-fade-in-up">
          {needsAccount && (
            <div className="mb-5">
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

          <label className={labelCls}>What’s in it?</label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ADDABLE.map((kind) => (
              <PieceCard
                key={kind}
                kind={kind}
                count={countOf(kind)}
                disabled={kind === 'ad' && noAdDesigns}
                disabledReason="No published ad designs are in scope for this account"
                onToggle={() => toggleKind(kind)}
                onAdd={() => add(kind)}
                onRemoveOne={() => removeLastOf(kind)}
              />
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted-foreground)]">
              {total === 0 ? 'Pick at least one piece.' : `${total} ${total === 1 ? 'piece' : 'pieces'} selected.`}
            </p>
            <button
              type="button"
              onClick={() => setStep('details')}
              disabled={!canContinue}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div key="details" className="animate-fade-in-up">
          <div className="space-y-3">
            {ordered.map((item, i) => {
              const meta = CHANNEL_META[item.kind];
              const Icon = meta.Icon;
              const sameKind = ordered.filter((x) => x.kind === item.kind);
              const n = sameKind.length > 1 ? ` ${sameKind.indexOf(item) + 1}` : '';
              return (
                <div key={item.localId} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                      <Icon className={`h-4 w-4 ${meta.tone.split(' ').pop()}`} />
                      {meta.label}
                      {n}
                    </span>
                    <button
                      onClick={() => {
                        remove(item.localId);
                        if (ordered.length === 1) setStep('pieces');
                      }}
                      className="text-[var(--muted-foreground)] transition hover:text-rose-400"
                      aria-label={`Remove ${meta.label.toLowerCase()}${n}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {item.kind === 'email' ? (
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>Subject</label>
                        <input
                          autoFocus={i === 0}
                          className={inputCls}
                          value={item.subject}
                          onChange={(e) => patch(item.localId, { subject: e.target.value })}
                        />
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
                  ) : item.kind === 'sms' ? (
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
                  ) : item.kind === 'ad' ? (
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>Name</label>
                        <input className={inputCls} value={item.name} onChange={(e) => patch(item.localId, { name: e.target.value })} placeholder="e.g. Spring service — square" />
                      </div>
                      <div>
                        <label className={labelCls}>Design</label>
                        <select className={inputCls} value={item.templateId} onChange={(e) => patch(item.localId, { templateId: e.target.value })}>
                          <option value="" disabled>
                            {adTemplates === null ? 'Loading designs…' : adTemplates.length ? 'Pick a design…' : 'No published designs for this account'}
                          </option>
                          {(adTemplates ?? []).map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                          A copy of the design, yours to fill in and adjust in the Ad Generator.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={labelCls}>Name</label>
                      <input
                        className={inputCls}
                        value={item.name}
                        onChange={(e) => patch(item.localId, { name: e.target.value })}
                        placeholder={
                          item.kind === 'landingPage' ? 'e.g. Spring service special' : item.kind === 'form' ? 'e.g. Book a service visit' : 'e.g. Service reminder drip'
                        }
                      />
                      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                        Created blank under this account — you’ll build it in the{' '}
                        {item.kind === 'landingPage' ? 'landing page' : item.kind === 'form' ? 'form' : 'flow'} builder after the campaign is created.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep('pieces')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              <ArrowLeftIcon className="h-4 w-4" /> Change the pieces
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Two dots and a rule — enough to say "there is a second step" without a wizard chrome. */
function StepDots({ step }: { step: Step }) {
  return (
    <div className="mb-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
      <span className={step === 'pieces' ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}>
        1. Pieces
      </span>
      <span className="h-px w-6 bg-[var(--border)]" />
      <span className={step === 'details' ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}>
        2. Details
      </span>
    </div>
  );
}

function PieceCard({
  kind,
  count,
  disabled,
  disabledReason,
  onToggle,
  onAdd,
  onRemoveOne,
}: {
  kind: CampaignAssetKind;
  count: number;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: () => void;
  onAdd: () => void;
  onRemoveOne: () => void;
}) {
  const meta = CHANNEL_META[kind];
  const Icon = meta.Icon as ComponentType<{ className?: string }>;
  const on = count > 0;

  return (
    <div
      className={`relative rounded-xl border p-3 text-left transition ${
        disabled
          ? 'cursor-not-allowed border-[var(--border)] bg-[var(--card)] opacity-50'
          : on
            ? 'border-[var(--primary)] bg-[var(--primary)]/10'
            : 'border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)]'
      }`}
      title={disabled ? disabledReason : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        className="block w-full text-left disabled:cursor-not-allowed"
      >
        <span className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${meta.tone}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="block text-sm font-medium text-[var(--foreground)]">{meta.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted-foreground)]">
          {PIECE_BLURB[kind]}
        </span>
      </button>

      {on && (
        <>
          <CheckCircleIcon className="absolute right-2.5 top-2.5 h-4 w-4 text-[var(--primary)]" />
          {/* Quantity lives on the card so a three-email campaign never needs a
              separate "add another" row below the grid. */}
          <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {count} {count === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRemoveOne}
                aria-label={`One fewer ${meta.label.toLowerCase()}`}
                className="flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <MinusIcon className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onAdd}
                aria-label={`One more ${meta.label.toLowerCase()}`}
                className="flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <PlusIcon className="h-3 w-3" />
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
