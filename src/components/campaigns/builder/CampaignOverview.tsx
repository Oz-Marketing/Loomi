'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  SparklesIcon,
  PaperAirplaneIcon,
  Squares2X2Icon,
  TrashIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { CampaignOfferDesigns } from './campaign-offer-designs';
import { useAccount } from '@/contexts/account-context';
import { toast } from '@/lib/toast';
import { CampaignStatusBadge, AssetStatusBadge, AutomatedChip, CHANNEL_META, assetEditorPath } from './shared';
import { CampaignEmailGallery } from './email-gallery';
import { EmailPreviewThumb } from './email-preview-thumb';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import type { CampaignAssetKind, CampaignAssetSummary, CampaignDetail } from '@/lib/campaigns/types';

// Ads first for an OEM offer run — they are the bulk of what it makes, and the
// email is the companion. Campaigns with no ads are unaffected.
const CHANNEL_ORDER: CampaignAssetKind[] = ['ad', 'email', 'sms', 'landingPage', 'form', 'flow'];

export function CampaignOverview({ campaignId }: { campaignId: string }) {
  const href = useSubaccountHref();
  const router = useRouter();
  const { accounts, userRole } = useAccount();
  // Reading is the client's whole grant here — deleting a run is staff-only.
  const isStaff = userRole !== 'client';
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CampaignAssetKind | 'all' | null>(null);
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

  // Bumped after a design pick: choosing a plate re-splices the run's offer
  // email through that template's shell, so the EMAIL half of this page is stale
  // too — not just the ad tiles.
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [campaignId, reloadKey]);

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
    // "Your account", not "Your dealership": Loomi is industry-agnostic in its
    // own copy, and a client here may be a clinic or a store.
    (campaign.accountKey && accounts[campaign.accountKey]?.dealer) || 'Your account';

  const availableChannels = CHANNEL_ORDER.filter((k) => byKind(k).length > 0);

  /**
   * "All" comes first and is the default whenever a campaign spans more than one
   * medium.
   *
   * The tabs alone were splitting a set. An OEM run makes the ads AND the offer
   * email from the same offers, and landing on an "Ads" tab with the email
   * behind a second click presents them as two pieces of work that happen to
   * share a page. They are one deliverable, so the default view shows the whole
   * thing and the per-medium tabs become a way to focus rather than the only way
   * to look. A single-medium campaign gets no "All" — it would be a tab that
   * duplicates the one beside it.
   */
  const tabs: (CampaignAssetKind | 'all')[] =
    availableChannels.length > 1 ? ['all', ...availableChannels] : availableChannels;
  const activeView: CampaignAssetKind | 'all' | null =
    activeTab && tabs.includes(activeTab) ? activeTab : tabs[0] ?? null;

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
      return (
        <CampaignEmailGallery
          assets={assets}
          href={href}
          showOpen={isStaff || campaign.source !== 'automation'}
        />
      );
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

    // Ads: a thumbnail grid. The generic `assetRow` list is right for a flow and
    // wrong for a plate — an ad is judged by looking at it, and a run's whole
    // point is the set of designs it produced. Falls back to the name when the
    // square preview is missing (no image storage configured, say), rather than
    // rendering an empty tile that reads as a broken ad.
    if (kind === 'ad') {
      return (
        <CampaignOfferDesigns
          adIds={assets.map((a) => a.id)}
          accountKey={campaign.accountKey}
          editorHref={(id) => assetEditorPath(href, 'ad', id)}
          onChanged={() => setReloadKey((n) => n + 1)}
          frozen={campaign.status === 'building'}
        />
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
    // Ads are the offer run's SHARED rows — deleting the campaign unlinks them
    // (the FK is SetNull) and they stay in the Ad Generator, re-attaching on
    // the next run while their offer is live. Say so, rather than let "delete
    // every asset" imply the designs go too.
    counts.ad && `${counts.ad} ad design${counts.ad === 1 ? '' : 's'} (unlinked — still in the Ad Generator)`,
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
        {isStaff && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-rose-400"
          >
            <TrashIcon className="h-4 w-4" /> Delete
          </button>
        )}
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
          {campaign.source === 'automation' ? (
            <AutomatedChip building={campaign.status === 'building'} />
          ) : (
            <CampaignStatusBadge status={campaign.status} />
          )}
          {campaign.source === 'ai' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              <SparklesIcon className="h-3.5 w-3.5" /> Built with AI
            </span>
          )}
        </div>
        {/* The goal is a person's brief, quoted back. An automation campaign's
            "goal" is the run id the generator stamped there — not something to
            quote at anyone. */}
        {campaign.goal && campaign.source !== 'automation' && (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">“{campaign.goal}”</p>
        )}
      </header>

      {campaign.source === 'automation' && campaign.status === 'building' && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-4 py-3">
          <BoltIcon className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse text-[var(--primary)]" />
          <p className="text-xs leading-relaxed text-[var(--foreground)]">
            Loomi is still building this campaign — designs may change until it finishes.
          </p>
        </div>
      )}

      {/* Drafts-only reminder — the builder never sends.
          An automation campaign reads differently: its viewer is usually the
          account's user, who picks a design and does NOT send — the account team
          does. And an ads-only campaign (email off for the account, the common
          shape) must not promise a send at all. */}
      {hasAssets && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <PaperAirplaneIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Everything below is a <span className="font-medium text-[var(--foreground)]">draft</span>.{' '}
            {campaign.source === 'automation'
              ? counts.email > 0
                ? 'Pick the design you want for each offer — your account team handles the send.'
                : 'Pick the design you want for each offer — nothing runs until your account team approves it.'
              : 'Open each one to review the content, choose who to send to, and schedule or publish — nothing has been sent.'}
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

      {/* "All" holds the set together; the rest focus one medium. */}
      {tabs.length > 0 && activeView && (
        <div>
          <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-[var(--border)]">
            {tabs.map((kind) => {
              const meta = kind === 'all' ? null : CHANNEL_META[kind];
              const count = kind === 'all' ? campaign.assets.length : byKind(kind).length;
              const isActive = kind === activeView;
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
                  {meta ? <meta.Icon className="h-4 w-4" /> : <Squares2X2Icon className="h-4 w-4" />}
                  {meta ? meta.plural : 'Everything'}
                  <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {activeView === 'all' ? (
            // Every medium in one scroll, each under its own heading. The
            // headings are what keep this legible for a six-channel campaign
            // while still showing the whole set at once.
            <div className="space-y-8">
              {availableChannels.map((kind) => {
                const meta = CHANNEL_META[kind];
                return (
                  <section key={kind}>
                    <div className="mb-3 flex items-center gap-2">
                      <meta.Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                      <h3 className="text-sm font-semibold text-[var(--foreground)]">{meta.plural}</h3>
                      <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                        {byKind(kind).length}
                      </span>
                    </div>
                    {renderChannelBody(kind)}
                  </section>
                );
              })}
            </div>
          ) : (
            renderChannelBody(activeView)
          )}
        </div>
      )}
    </div>
  );
}
