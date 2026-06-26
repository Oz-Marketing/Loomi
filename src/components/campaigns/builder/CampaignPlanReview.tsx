'use client';

import { useRef, useState } from 'react';
import {
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  QuestionMarkCircleIcon,
  SparklesIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import {
  SMS_MAX_CHARS,
  type CampaignPlan,
  type CampaignPlanAsset,
  type CampaignPlanEmailSpec,
  type CampaignPlanSmsSpec,
} from '@/lib/campaigns/types';
import { classifyAssetKind } from '@/lib/campaigns/asset-matching';

const ASSET_KINDS: { value: CampaignPlanAsset['kind']; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'landingPage', label: 'Landing page' },
  { value: 'form', label: 'Form' },
  { value: 'generic', label: 'Any' },
];

function newKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${prefix}${Math.round(performance.now())}`;
  return `${prefix}-${rand}`;
}

const inputCls =
  'w-full rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]/60';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]';

export function CampaignPlanReview({
  plan,
  onChange,
  onApprove,
  approving,
  accountKey,
}: {
  plan: CampaignPlan;
  onChange: (plan: CampaignPlan) => void;
  onApprove: () => void;
  approving: boolean;
  accountKey: string;
}) {
  const update = (patch: Partial<CampaignPlan>) => onChange({ ...plan, ...patch });

  // ── Asset upload (brand images for the AI to use) ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const assets = plan.assets ?? [];

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!accountKey) {
      setUploadError('Select an account before uploading assets.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    const added: CampaignPlanAsset[] = [];
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('accountKey', accountKey);
        fd.append('category', 'campaign');
        const res = await fetch('/api/media', { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok && data?.file?.url) {
          const filename = data.file.name || file.name;
          added.push({ url: data.file.url, filename, kind: classifyAssetKind(filename) });
        } else {
          setUploadError(data?.error || 'Upload failed');
        }
      } catch {
        setUploadError('Upload failed');
      }
    }
    setUploading(false);
    if (added.length) update({ assets: [...assets, ...added] });
  };

  const updateAssetKind = (idx: number, kind: CampaignPlanAsset['kind']) =>
    update({ assets: assets.map((a, i) => (i === idx ? { ...a, kind } : a)) });
  const removeAsset = (idx: number) => update({ assets: assets.filter((_, i) => i !== idx) });

  const updateEmail = (key: string, patch: Partial<CampaignPlanEmailSpec>) =>
    update({ emails: plan.emails.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
  const removeEmail = (key: string) => update({ emails: plan.emails.filter((e) => e.key !== key) });
  const addEmail = () =>
    update({
      emails: [
        ...plan.emails,
        {
          key: newKey('e'),
          purpose: 'New email',
          subject: '',
          previewText: '',
          keyPoints: [],
          sendOffsetDays: plan.emails.length ? (plan.emails[plan.emails.length - 1].sendOffsetDays ?? 0) + 2 : 0,
          mode: 'visual',
        },
      ],
    });

  const updateSms = (key: string, patch: Partial<CampaignPlanSmsSpec>) =>
    update({ sms: plan.sms.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const removeSms = (key: string) => update({ sms: plan.sms.filter((s) => s.key !== key) });
  const addSms = () =>
    update({
      sms: [
        ...plan.sms,
        { key: newKey('s'), purpose: 'New text', message: '', sendOffsetDays: 0, mediaUrls: [] },
      ],
    });

  const updateClarification = (id: string, answer: string) =>
    update({ clarifications: plan.clarifications.map((c) => (c.id === id ? { ...c, answer } : c)) });

  const totalTouches = plan.emails.length + plan.sms.length;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Summary */}
      <div className="mb-6">
        <label className={labelCls}>Campaign summary</label>
        <input
          className={inputCls}
          value={plan.summary}
          onChange={(e) => update({ summary: e.target.value })}
          placeholder="What this campaign does"
        />
      </div>

      {/* Email format toggle */}
      {plan.emails.length > 0 && (
        <div className="mb-6">
          <label className={labelCls}>Email format</label>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-0.5">
            {(['html', 'blocks'] as const).map((f) => {
              const active = (plan.emailFormat ?? 'html') === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => update({ emailFormat: f })}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {f === 'html' ? 'Rich HTML' : 'Editable blocks'}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            {(plan.emailFormat ?? 'html') === 'html'
              ? 'Full-design HTML emails — edit in the code editor. Best for rich, multi-column layouts.'
              : 'Drag-and-drop blocks — edit visually in the builder.'}
          </p>
        </div>
      )}

      {/* Brand images — uploaded assets the AI will place into the matching medium */}
      <div className="mb-6">
        <label className={labelCls}>Brand images (optional)</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-4 text-sm text-[var(--muted-foreground)] transition hover:border-[var(--primary)]/40 hover:text-[var(--foreground)] disabled:opacity-60"
        >
          <ArrowUpTrayIcon className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload images (logos, hero shots, product photos)'}
        </button>
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          We route each image by its filename (e.g. “email-…”, “lp-…”) — adjust below. The AI places them in the matching medium.
        </p>
        {uploadError && <p className="mt-1 text-[11px] text-rose-400">{uploadError}</p>}

        {assets.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset, i) => (
              <div key={`${asset.url}-${i}`} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
                <div className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded-md bg-[var(--muted)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.filename} className="h-full w-full object-contain" />
                </div>
                <p className="mb-1 truncate text-[10px] text-[var(--muted-foreground)]" title={asset.filename}>
                  {asset.filename}
                </p>
                <div className="flex items-center gap-1">
                  <select
                    value={asset.kind}
                    onChange={(e) => updateAssetKind(i, e.target.value as CampaignPlanAsset['kind'])}
                    className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--card-strong)] px-1.5 py-1 text-[11px] text-[var(--foreground)] outline-none"
                  >
                    {ASSET_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeAsset(i)}
                    className="text-[var(--muted-foreground)] transition hover:text-rose-400"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested audience (display only) */}
      {plan.audience?.description && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <UserGroupIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">Suggested audience</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {plan.audience.description}
              {plan.audience.estimatedSizeNote ? ` — ${plan.audience.estimatedSizeNote}` : ''}
            </p>
            <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
              You’ll pick the exact recipients when you open each draft to send.
            </p>
          </div>
        </div>
      )}

      {/* Clarifications */}
      {plan.clarifications.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <QuestionMarkCircleIcon className="h-4 w-4" /> A few details would sharpen this
          </p>
          <div className="space-y-3">
            {plan.clarifications.map((c) => (
              <div key={c.id}>
                <label className="mb-1 block text-xs text-[var(--foreground)]">{c.question}</label>
                <input
                  className={inputCls}
                  value={c.answer ?? ''}
                  onChange={(e) => updateClarification(c.id, e.target.value)}
                  placeholder="Optional — answer to improve the result"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Emails */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <EnvelopeIcon className="h-4 w-4 text-sky-400" /> Emails ({plan.emails.length})
          </h3>
          <button onClick={addEmail} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
            <PlusIcon className="h-3.5 w-3.5" /> Add email
          </button>
        </div>
        <div className="space-y-3">
          {plan.emails.map((email, i) => (
            <div key={email.key} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Email {i + 1}
                </span>
                <button onClick={() => removeEmail(email.key)} className="text-[var(--muted-foreground)] transition hover:text-rose-400">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Subject</label>
                  <input className={inputCls} value={email.subject} onChange={(e) => updateEmail(email.key, { subject: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Purpose</label>
                    <input className={inputCls} value={email.purpose} onChange={(e) => updateEmail(email.key, { purpose: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Send day (offset)</label>
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={email.sendOffsetDays ?? 0}
                      onChange={(e) => updateEmail(email.key, { sendOffsetDays: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Key points (one per line)</label>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={3}
                    value={(email.keyPoints ?? []).join('\n')}
                    onChange={(e) => updateEmail(email.key, { keyPoints: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              </div>
            </div>
          ))}
          {plan.emails.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
              No emails in this campaign.
            </p>
          )}
        </div>
      </section>

      {/* SMS */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <ChatBubbleLeftRightIcon className="h-4 w-4 text-emerald-400" /> Text messages ({plan.sms.length})
          </h3>
          <button onClick={addSms} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
            <PlusIcon className="h-3.5 w-3.5" /> Add SMS
          </button>
        </div>
        <div className="space-y-3">
          {plan.sms.map((sms, i) => (
            <div key={sms.key} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  SMS {i + 1}
                </span>
                <button onClick={() => removeSms(sms.key)} className="text-[var(--muted-foreground)] transition hover:text-rose-400">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Message</label>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={3}
                    maxLength={SMS_MAX_CHARS}
                    value={sms.message}
                    onChange={(e) => updateSms(sms.key, { message: e.target.value })}
                  />
                  <p className="mt-1 text-right text-[10px] text-[var(--muted-foreground)]">
                    {sms.message.length}/{SMS_MAX_CHARS}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Purpose</label>
                    <input className={inputCls} value={sms.purpose} onChange={(e) => updateSms(sms.key, { purpose: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Send day (offset)</label>
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={sms.sendOffsetDays ?? 0}
                      onChange={(e) => updateSms(sms.key, { sendOffsetDays: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
          {plan.sms.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
              No text messages in this campaign.
            </p>
          )}
        </div>
      </section>

      {/* Approve */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card-strong)]/95 px-4 py-3 backdrop-blur">
        <span className="text-xs text-[var(--muted-foreground)]">
          {totalTouches} touch{totalTouches === 1 ? '' : 'es'} · everything lands as a draft
        </span>
        <button
          onClick={onApprove}
          disabled={approving || totalTouches === 0}
          className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparklesIcon className="h-4 w-4" />
          {approving ? 'Starting…' : 'Generate campaign'}
        </button>
      </div>
    </div>
  );
}
