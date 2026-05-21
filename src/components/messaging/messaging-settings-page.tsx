'use client';

// Messaging-scoped settings page. Lives inside the messaging section
// (vs. global sub-account settings) because these surfaces are tightly
// coupled to the email engine: Sending controls sender identity +
// SendGrid keys, Suppressions is the bounce/unsub list that the
// campaign builder hygiene filter consumes.
//
// Tabs are URL-driven: /subaccount/<slug>/messaging/settings/<tab> or
// /messaging/settings/<tab> for admin. Mirrors the existing global
// settings pattern so deep links work and back/forward stays sane.

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PaperAirplaneIcon,
  NoSymbolIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { SendingTab } from '@/components/settings/sending-tab';
import { SuppressionsTab } from '@/components/settings/suppressions-tab';
import { SmsTab } from '@/components/settings/sms-tab';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

type MessagingSettingsTab = 'sending' | 'sms' | 'suppressions';

const TABS: Array<{ key: MessagingSettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'sending', label: 'Email', icon: PaperAirplaneIcon },
  { key: 'sms', label: 'SMS', icon: ChatBubbleLeftRightIcon },
  { key: 'suppressions', label: 'Suppressions', icon: NoSymbolIcon },
];

interface MessagingSettingsPageProps {
  /** Active tab, resolved from the URL by the route handler. */
  tab: MessagingSettingsTab;
}

export function MessagingSettingsPage({ tab }: MessagingSettingsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const subHref = useSubaccountHref();
  const { accountKey, accountData } = useAccount();

  // The route segments under .../settings drive the active tab — the
  // page passes the resolved tab in as a prop but tab clicks need to
  // navigate to the corresponding URL.
  const baseSegments = pathname.split('/').filter(Boolean);
  const settingsIdx = baseSegments.lastIndexOf('settings');
  const basePath =
    settingsIdx >= 0
      ? '/' + baseSegments.slice(0, settingsIdx + 1).join('/')
      : '/messaging/settings';

  const switchTab = useCallback(
    (next: MessagingSettingsTab) => {
      router.push(`${basePath}/${next}`);
    },
    [router, basePath],
  );

  const accountLabel = accountData?.dealer || 'Sub-Account';
  const backHref = subHref('/messaging/campaigns');

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="mb-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-3"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back to Campaigns
        </Link>
        <h1 className="text-2xl font-bold">Messaging Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Sender identity, transport credentials, and suppression rules that apply to every
          email + SMS campaign sent from{' '}
          <span className="text-[var(--foreground)] font-medium">{accountLabel}</span>.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 mb-5 border-b border-[var(--border)]">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={`inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'sending' && <SendingTab accountKey={accountKey || ''} />}
      {tab === 'sms' && <SmsTab accountKey={accountKey || ''} />}
      {tab === 'suppressions' && <SuppressionsTab accountKey={accountKey || ''} />}
    </div>
  );
}

export type { MessagingSettingsTab };
