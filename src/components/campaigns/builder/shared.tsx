'use client';

/**
 * Shared bits for the AI Campaign Builder UI — status pills, channel
 * metadata, and the deep-link map into each per-channel editor (where final
 * targeting + send/publish happens, since the builder itself never sends).
 */
import {
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  RectangleStackIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import type { CampaignAssetKind, CampaignStatus } from '@/lib/campaigns/types';

export const CHANNEL_META: Record<
  CampaignAssetKind,
  { label: string; plural: string; Icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  email: { label: 'Email', plural: 'Emails', Icon: EnvelopeIcon, tone: 'bg-sky-500/10 text-sky-400' },
  sms: { label: 'SMS', plural: 'Text messages', Icon: ChatBubbleLeftRightIcon, tone: 'bg-emerald-500/10 text-emerald-400' },
  landingPage: { label: 'Landing page', plural: 'Landing pages', Icon: RectangleStackIcon, tone: 'bg-violet-500/10 text-violet-400' },
  form: { label: 'Form', plural: 'Forms', Icon: DocumentTextIcon, tone: 'bg-cyan-500/10 text-cyan-400' },
  flow: { label: 'Flow', plural: 'Flows', Icon: FlowIcon as React.ComponentType<{ className?: string }>, tone: 'bg-amber-500/10 text-amber-400' },
};

const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, string> = {
  draft: 'bg-zinc-500/15 text-zinc-300',
  building: 'bg-sky-500/15 text-sky-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-300',
  archived: 'bg-zinc-700/40 text-zinc-400',
};

const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  building: 'Building…',
  ready: 'Ready to review',
  partial: 'In progress',
  archived: 'Archived',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${CAMPAIGN_STATUS_TONE[status]}`}>
      {CAMPAIGN_STATUS_LABEL[status]}
    </span>
  );
}

/** Per-asset draft/published status pill (the asset's own native status). */
export function AssetStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'draft'
      ? 'bg-zinc-500/15 text-zinc-300'
      : status === 'published' || status === 'active' || status === 'completed'
        ? 'bg-emerald-500/15 text-emerald-300'
        : status === 'failed' || status === 'canceled'
          ? 'bg-rose-500/15 text-rose-300'
          : 'bg-sky-500/15 text-sky-300';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

/**
 * Returns the in-app editor path for an asset, given an href builder
 * (`useSubaccountHref()`), so links stay within the active sub-account.
 */
export function assetEditorPath(
  href: (p: string) => string,
  kind: CampaignAssetKind,
  id: string,
): string {
  switch (kind) {
    case 'email':
      return href(`/messaging/blasts/${id}/recipients`);
    case 'sms':
      return href(`/messaging/blasts/sms/${id}/recipients`);
    case 'landingPage':
      return href(`/websites/landing-pages/${id}`);
    case 'form':
      return href(`/websites/forms/${id}`);
    case 'flow':
      return href(`/flows/${id}`);
  }
}
