'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  Squares2X2Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface CreateCampaignModalProps {
  open: boolean;
  onClose: () => void;
  /** Subaccount keys to scope the new campaign to. Empty = pick later. */
  accountKeys?: string[];
  /** Optional path override for where to navigate after draft creation. */
  redirectBase?: string;
}

type ChannelType = 'email' | 'sms' | 'both';

function defaultName(): string {
  const now = new Date();
  return `Campaign ${now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function CreateCampaignModal({
  open,
  onClose,
  accountKeys,
  redirectBase,
}: CreateCampaignModalProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<ChannelType>('email');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName());
      setChannel('email');
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit =
    name.trim().length > 0 && (channel === 'email' || channel === 'sms') && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const isSms = channel === 'sms';
      const endpoint = isSms ? '/api/campaigns/sms/draft' : '/api/campaigns/email/draft';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          accountKeys: accountKeys || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to create campaign');
      const campaignId = data?.campaign?.id;
      if (!campaignId) throw new Error('Campaign created but no ID returned');
      const base = redirectBase || '/campaigns';
      const path = isSms
        ? `${base}/sms/${encodeURIComponent(campaignId)}/recipients`
        : `${base}/${encodeURIComponent(campaignId)}/recipients`;
      router.push(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
      onClick={onClose}
    >
      <div
        className="glass-modal w-[600px] max-w-[calc(100vw-3rem)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)] flex-shrink-0">
          <h3 className="text-lg font-semibold">Create campaign</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {/* Campaign name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Campaign Name <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring Service Offer"
              autoFocus
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>

          {/* Campaign type (always Single Channel for now) */}
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Campaign Type
            </label>
            <div className="rounded-xl border-2 border-[var(--primary)] bg-[var(--primary)]/[0.05] p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                <Squares2X2Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">Single channel</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Send a one-time message to a specific audience.
                </p>
              </div>
            </div>
          </div>

          {/* Channel type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Type
            </label>
            <div className="space-y-2">
              <ChannelOption
                value="email"
                current={channel}
                onSelect={setChannel}
                icon={EnvelopeIcon}
                label="Email"
                description="Send an email campaign to your audience."
              />
              <ChannelOption
                value="sms"
                current={channel}
                onSelect={setChannel}
                icon={ChatBubbleLeftRightIcon}
                label="Text Messaging"
                description="Send an SMS/MMS blast through your subaccount's GHL connection."
              />
              <ChannelOption
                value="both"
                current={channel}
                onSelect={setChannel}
                icon={Squares2X2Icon}
                label="Both"
                description="Multi-channel sends (email + SMS) ship in the next release."
                disabled
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            Cancel
          </button>
          <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Continue'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ChannelOption({
  value,
  current,
  onSelect,
  icon: Icon,
  label,
  description,
  disabled,
}: {
  value: ChannelType;
  current: ChannelType;
  onSelect: (v: ChannelType) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(value)}
      disabled={disabled}
      className={`w-full rounded-xl border-2 p-3.5 flex items-start gap-3 text-left transition-all ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm font-medium ${active ? 'text-[var(--foreground)]' : 'text-[var(--foreground)]'}`}
          >
            {label}
          </p>
          {disabled && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded">
              Coming soon
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
      </div>
    </button>
  );
}
