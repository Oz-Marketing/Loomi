'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  SparklesIcon,
  PaperAirplaneIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { toast } from '@/lib/toast';
import { CampaignStatusBadge, AssetStatusBadge, CHANNEL_META, assetEditorPath } from './shared';
import { CampaignEmailGallery } from './email-gallery';
import { EmailPreviewThumb } from './email-preview-thumb';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import type { CampaignAssetKind, CampaignAssetSummary, CampaignDetail } from '@/lib/campaigns/types';

const CHANNEL_ORDER: CampaignAssetKind[] = ['email', 'sms', 'landingPage', 'form', 'flow'];

export function CampaignOverview({ campaignId }: { campaignId: string }) {
  const href = useSubaccountHref();
  const router = useRouter();
  const { accounts } = useAccount();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CampaignAssetKind | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to delete campaign');
      }
      router.push(href('/campaign-builder'));
    } catch (err) {
      setDeleting(false);
      setConfirmingDelete(false);
      toast.error(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.campaign) setCampaign(data.campaign);
        else setError(data?.error || 'Campaign not found');
      })
      .catch(() => !cancelled && setError('Failed to load campaign'));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        <Link href={href('/campaign-builder')} className="mt-3 inline-block text-sm text-[var(--primary)]">
          ← Back to campaigns
        </Link>
      </div>
    );
  }

  if (!campaign) {
    return <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>;
  }

  // Order assets by their plan key's trailing number (e1, e2 / s1, s2 = send
  // order) so the SMS thread, the list, and the email pager all read in send
  // order and stay consistent. Assets without a plan key (manual) keep their
  // original relative order (stable sort).
  const planKeyNum = (a: CampaignAssetSummary): number => {
    const m = a.planKey?.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  const byKind = (kind: CampaignAssetKind): CampaignAssetSummary[] =>
    campaign.assets.filter((a) => a.kind === kind).sort((a, b) => planKeyNum(a) - planKeyNum(b));

  const hasAssets = campaign.assetCounts.total > 0;
  const canResume = !hasAssets && campaign.source === 'ai' && !!campaign.plan;
  const dealerName =
    (campaign.accountKey && accounts[campaign.accountKey]?.dealer) || 'Your dealership';

  // One tab per channel that has assets; default to the first available.
  const availableChannels = CHANNEL_ORDER.filter((k) => byKind(k).length > 0);
  const activeChannel =
    activeTab && availableChannels.includes(activeTab) ? activeTab : availableChannels[0] ?? null;

  // Compact row: asset name + status + Open link. Used for SMS/LP/form/flow.
  const assetRow = (asset: CampaignAssetSummary) => (
    <div
      key={asset.id}
      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3"
    >
      <p className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{asset.name}</p>
      <div className="flex flex-shrink-0 items-center gap-3">
        <AssetStatusBadge status={asset.status} />
        <Link
          href={assetEditorPath(href, asset.kind, asset.id)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition hover:underline"
        >
          Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );

  // The content for a single channel tab (no header — the tab is the header).
  const renderChannelBody = (kind: CampaignAssetKind) => {
    const assets = byKind(kind);

    // Emails: one at a time, with a dot pager + desktop/mobile preview toggle.
    if (kind === 'email') {
      return <CampaignEmailGallery assets={assets} href={href} />;
    }

    // SMS: phone on the LEFT (all texts as one thread), Open list on the RIGHT.
    if (kind === 'sms') {
      return (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="md:shrink-0">
            <IphoneSmsPreview
              dealerName={dealerName}
              messages={assets.map((a) => ({
                message: a.smsMessage ?? '',
                mediaUrls: a.smsMediaUrls ?? [],
              }))}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">{assets.map(assetRow)}</div>
        </div>
      );
    }

    // Landing pages: each with a scaled HTML preview.
    if (kind === 'landingPage') {
      return (
        <div className="space-y-4">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{asset.name}</p>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <AssetStatusBadge status={asset.status} />
                  <Link
                    href={assetEditorPath(href, asset.kind, asset.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition hover:underline"
                  >
                    Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
              {asset.lpHtml && (
                <div className="mt-3">
                  <EmailPreviewThumb html={asset.lpHtml} maxHeight={620} />
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Forms: each with a field summary.
    if (kind === 'form') {
      return (
        <div className="space-y-4">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{asset.name}</p>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <AssetStatusBadge status={asset.status} />
                  <Link
                    href={assetEditorPath(href, asset.kind, asset.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition hover:underline"
                  >
                    Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
              {asset.formFields && asset.formFields.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {asset.formFields.map((f, i) => (
                    <li
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-2 py-1 text-xs"
                    >
                      <span className="text-[var(--foreground)]">{f.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{f.type}</span>
                      {f.required && <span className="text-[10px] text-rose-400">*</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Flows (Phase 3) — compact list.
    return <div className="space-y-2">{assets.map(assetRow)}</div>;
  };

  const counts = campaign.assetCounts;
  const deleteSummary = [
    counts.email && `${counts.email} email${counts.email === 1 ? '' : 's'}`,
    counts.sms && `${counts.sms} text${counts.sms === 1 ? '' : 's'}`,
    counts.landingPage && `${counts.landingPage} landing page${counts.landingPage === 1 ? '' : 's'}`,
    counts.form && `${counts.form} form${counts.form === 1 ? '' : 's'}`,
    counts.flow && `${counts.flow} flow${counts.flow === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="animate-fade-in-up mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link
          href={href('/campaign-builder')}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-4 w-4" /> All campaigns
        </Link>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-rose-400"
        >
          <TrashIcon className="h-4 w-4" /> Delete
        </button>
      </div>

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setConfirmingDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[var(--foreground)]">Delete this campaign?</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              This permanently deletes <span className="font-medium text-[var(--foreground)]">“{campaign.name}”</span>
              {deleteSummary ? ` and all of its drafts (${deleteSummary})` : ''} — removing them from their channel
              pages too. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
          {campaign.source === 'ai' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              <SparklesIcon className="h-3.5 w-3.5" /> Built with AI
            </span>
          )}
        </div>
        {campaign.goal && (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">“{campaign.goal}”</p>
        )}
      </header>

      {/* Drafts-only reminder — the builder never sends. */}
      {hasAssets && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <PaperAirplaneIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Everything below is a <span className="font-medium text-[var(--foreground)]">draft</span>. Open each one
            to review the content, choose who to send to, and schedule or publish — nothing has been sent.
          </p>
        </div>
      )}

      {canResume && (
        <div className="mb-6 glass-card rounded-xl p-6 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            This campaign has a plan but hasn’t been generated yet.
          </p>
          <Link
            href={href(`/campaign-builder/new?campaign=${campaign.id}`)}
            className="iris-rainbow-gradient mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90"
          >
            <SparklesIcon className="h-4 w-4" /> Resume build
          </Link>
        </div>
      )}

      {/* One tab per medium — keeps content from stacking into a long scroll. */}
      {availableChannels.length > 0 && activeChannel && (
        <div>
          <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-[var(--border)]">
            {availableChannels.map((kind) => {
              const meta = CHANNEL_META[kind];
              const count = byKind(kind).length;
              const isActive = kind === activeChannel;
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(kind)}
                  className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-[var(--primary)] text-[var(--foreground)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <meta.Icon className="h-4 w-4" />
                  {meta.plural}
                  <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {renderChannelBody(activeChannel)}
        </div>
      )}
    </div>
  );
}
