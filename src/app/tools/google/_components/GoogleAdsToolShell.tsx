'use client';

/**
 * §8 Google Ads tool landing (Planner / Pacer). The manual planner/pacer mirrors
 * the Meta tool (which works without any API connection — sync just auto-fills
 * spend); it's wired on top of the §8 backend foundation. Until that UI lands,
 * this surface shows the per-account Google connection state and routes to the
 * Integrations grid, so the nav + onboarding path are live now.
 */
import useSWR from 'swr';
import Link from 'next/link';
import { useAccount } from '@/contexts/account-context';
import { GoogleAdsBrandIcon } from '@/components/icons/platform-logos';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData } = useAccount();
  const { data } = useSWR<{ googleAdsCustomerId?: string | null }>(
    accountKey ? `/api/accounts/${encodeURIComponent(accountKey)}` : null,
    fetcher,
  );
  const customerId = (data?.googleAdsCustomerId ?? '').toString().trim() || null;
  const connected = !!customerId;
  const title = mode === 'planner' ? 'Ad Planner' : 'Ad Pacer';
  const verb = mode === 'planner' ? 'plan' : 'pace';
  const integrationsHref = accountKey ? `/subaccounts/${encodeURIComponent(accountKey)}` : '/subaccounts';

  return (
    <div className="animate-fade-in-up pt-4 max-w-3xl">
      <header className="mb-6 flex items-center gap-3">
        <GoogleAdsBrandIcon className="h-8 w-8" />
        <div>
          <h1 className="m-0 text-2xl font-bold text-[var(--foreground)]">
            Google Ads · {title}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {accountKey ? (accountData?.dealer ?? accountKey) : 'No sub-account selected'}
          </p>
        </div>
      </header>

      {!accountKey ? (
        <div className="glass-section-card rounded-xl p-6 text-sm text-[var(--muted-foreground)]">
          Select a sub-account from the switcher to {verb} its Google campaigns.
        </div>
      ) : (
        <>
          {/* Connection status */}
          <section className="glass-section-card rounded-xl p-6 mb-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: connected ? '#22c55e' : 'var(--muted-foreground)' }}
                  />
                  <h2 className="m-0 text-sm font-semibold text-[var(--foreground)]">
                    {connected ? 'Google Ads connected' : 'Google Ads not connected'}
                  </h2>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  {connected
                    ? `Linked to Google customer ${customerId}. Auto-import of campaigns and spend sync turn on once the agency Google Ads API token is configured — then this becomes a full ${title.toLowerCase()}, the same as Meta.`
                    : `Link this dealer's Google Ads customer to auto-import campaigns and sync spend. You'll also be able to ${verb} manually — no connection required — just like the Meta tools.`}
                </p>
              </div>
              <Link
                href={integrationsHref}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                {connected ? 'Manage in Integrations' : 'Connect in Integrations'}
              </Link>
            </div>
          </section>

          {/* Manual planning — mirrors Meta */}
          <section className="glass-section-card rounded-xl p-6">
            <h2 className="m-0 text-sm font-semibold text-[var(--foreground)]">
              Manual {title.toLowerCase()}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              Like the Meta {title}, you&apos;ll {verb} Google campaigns here without
              needing the API — the connection only auto-fills imported campaigns and
              actual spend. The §8 backend (campaign import, cost-sync, channel-group
              pacing, the daily set-vs-needed roll-up) is already in place; the manual
              {' '}{mode === 'planner' ? 'allocation' : 'pacing'} surface is being wired
              on next.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
