'use client';

// Everything about sending email and text for one account, behind a single
// "Email & Texts" entry in the settings nav.
//
// These were four sibling nav sections (Email / Email Footer / SMS /
// Suppressions), which read as four unrelated pages when they're really one
// job. Collapsing them means the nav says what the area is, and the tabs say
// what's in it.
//
// The active sub-tab is addressable as ?section=<key> so a "fix this in
// settings" link can deep-link to the right one — the schedule step's
// preflight remedy and the portfolio suppression widget both rely on that.
// It is a query param rather than a route segment because the section is a
// detail of this page, not another level of settings.

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  PaperAirplaneIcon,
  DocumentTextIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';
import { SendingTab } from '@/components/settings/sending-tab';
import { SmsTab } from '@/components/settings/sms-tab';
import { EmailFooterTab } from '@/components/settings/email-footer-tab';
import { SuppressionsTab } from '@/components/settings/suppressions-tab';

export type EmailTextsSection = 'sending' | 'footer' | 'suppressions';

const SECTIONS: Array<{
  key: EmailTextsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'sending', label: 'Sending Config', icon: PaperAirplaneIcon },
  { key: 'footer', label: 'Email Footer', icon: DocumentTextIcon },
  { key: 'suppressions', label: 'Suppressions', icon: NoSymbolIcon },
];

/**
 * Accept the old per-section keys as aliases. Links and bookmarks pointing at
 * `sms` or `email-footer` predate this page and shouldn't 404 into the wrong
 * tab; SMS now lives inside Sending Config.
 */
const ALIASES: Record<string, EmailTextsSection> = {
  sending: 'sending',
  sms: 'sending',
  footer: 'footer',
  'email-footer': 'footer',
  suppressions: 'suppressions',
};

interface EmailTextsTabProps {
  accountKey: string;
}

export function EmailTextsTab({ accountKey }: EmailTextsTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active: EmailTextsSection = useMemo(() => {
    const raw = searchParams.get('section') || '';
    return ALIASES[raw] ?? 'sending';
  }, [searchParams]);

  const switchSection = useCallback(
    (next: EmailTextsSection) => {
      // Preserve whatever else is on the URL — the admin browse route
      // carries ?tab= to select this section in the first place, and
      // dropping it would bounce the user out of Email & Texts entirely.
      const params = new URLSearchParams(searchParams.toString());
      params.set('section', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-[var(--border)] overflow-x-auto">
        {SECTIONS.map(({ key, label, icon: Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchSection(key)}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Sending Config — email identity and SMS together. They're the same
          decision from the user's side ("how does this account send?"), and
          both are hard preflight blockers when unset. */}
      {active === 'sending' && (
        <div className="space-y-4">
          <SendingTab accountKey={accountKey} />
          <SmsTab accountKey={accountKey} />
        </div>
      )}

      {active === 'footer' && <EmailFooterTab accountKey={accountKey} />}

      {active === 'suppressions' && <SuppressionsTab accountKey={accountKey} />}
    </div>
  );
}
