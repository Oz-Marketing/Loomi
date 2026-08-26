'use client';

/**
 * Account Domains tab — manage custom subdomains that point at our
 * infra (e.g. `offers.dealership.com`) for landing-page hosting.
 *
 * Lifecycle a user goes through here:
 *   1. Add hostname → row created, verification token issued.
 *   2. Add DNS records at their registrar (TXT for verification +
 *      CNAME for traffic).
 *   3. Click Verify → backend resolves the TXT record; on match,
 *      sets `verifiedAt` and the domain goes live.
 *   4. Optionally pick a "home" LP for the root path.
 *   5. Delete when retired.
 *
 * SSL: not handled in-app. Our deployment infra needs to terminate
 * TLS for every hostname pointed at us (Cloudflare for SaaS, DO LB
 * with custom certs, Caddy + ACME). Surfaced as a small note below
 * the DNS instructions so customers aren't surprised when http://
 * works before https:// does.
 */
import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  HomeIcon,
  LockClosedIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { LandingPageSummary } from '@/lib/services/landing-pages';

interface AccountDomain {
  id: string;
  accountKey: string;
  hostname: string;
  verificationToken: string;
  verifiedAt: string | null;
  homeLandingPageId: string | null;
  cloudflareSslStatus: 'pending' | 'active' | 'failed' | null;
  dns: {
    txtName: string;
    txtValue: string;
    cnameName: string;
    cnameTarget: string;
  };
  createdAt: string;
  updatedAt: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export function AccountDomainsTab({ accountKey }: { accountKey: string }) {
  const { data, mutate, isLoading } = useSWR<{ domains: AccountDomain[] }>(
    `/api/account-domains?accountKey=${encodeURIComponent(accountKey)}`,
    fetcher,
  );
  // Pages list — used by the per-domain "Home page" picker. Filtered
  // to published only since draft LPs shouldn't be reachable at the
  // root of a public domain.
  const { data: pagesData } = useSWR<{ pages: LandingPageSummary[] }>(
    `/api/landing-pages`,
    fetcher,
  );
  const accountPages = (pagesData?.pages ?? []).filter(
    (p) => p.accountKey === accountKey && p.status === 'published',
  );

  const domains = data?.domains ?? [];

  return (
    <div className="space-y-5">
      <Intro />
      <AddDomainForm accountKey={accountKey} onAdded={() => void mutate()} />

      {isLoading ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-[var(--muted-foreground)]">
          Loading domains…
        </div>
      ) : domains.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              pages={accountPages}
              onChanged={() => void mutate()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Intro / empty state ────────────────────────────────────────────

function Intro() {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--primary) 15%, transparent)',
            color: 'var(--primary)',
          }}
        >
          <GlobeAltIcon className="w-4 h-4" />
        </span>
        <div className="text-sm leading-relaxed">
          <p className="font-medium">Serve landing pages from your own subdomain.</p>
          <p className="text-[var(--muted-foreground)] mt-1">
            Add a subdomain like <code className="font-mono">offers.yoursite.com</code>, then
            point DNS at us via CNAME. Once verified, every published LP on this account is
            reachable at <code className="font-mono">that-hostname/&lt;slug&gt;</code>. Your
            main site is untouched.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card rounded-2xl p-8 text-center">
      <GlobeAltIcon className="w-8 h-8 mx-auto mb-2 text-[var(--muted-foreground)] opacity-50" />
      <p className="text-sm font-medium">No custom domains yet.</p>
      <p className="text-xs text-[var(--muted-foreground)] mt-1">
        Add a hostname above to get started.
      </p>
    </div>
  );
}

// ── Add-domain form ────────────────────────────────────────────────

function AddDomainForm({
  accountKey,
  onAdded,
}: {
  accountKey: string;
  onAdded: () => void;
}) {
  const [hostname, setHostname] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostname.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/account-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, hostname: hostname.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not add domain');
        return;
      }
      setHostname('');
      onAdded();
      toast.success('Domain added — follow the DNS instructions below to verify.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-4">
      <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
        Add a custom domain
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="offers.yoursite.com"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg outline-none focus:border-[var(--primary)] font-mono"
        />
        <button
          type="submit"
          disabled={!hostname.trim() || submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          <PlusIcon className="w-4 h-4" />
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
        Subdomain only (e.g. <code className="font-mono">offers.yoursite.com</code>). Don&apos;t
        include <code className="font-mono">https://</code> or a path.
      </p>
    </form>
  );
}

// ── Per-domain card ────────────────────────────────────────────────

function DomainCard({
  domain,
  pages,
  onChanged,
}: {
  domain: AccountDomain;
  pages: LandingPageSummary[];
  onChanged: () => void;
}) {
  const [verifying, setVerifying] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [updatingHome, setUpdatingHome] = React.useState(false);
  const [refreshingSsl, setRefreshingSsl] = React.useState(false);
  const verified = !!domain.verifiedAt;

  const handleVerify = async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/account-domains/${domain.id}/verify`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Verification failed');
        return;
      }
      onChanged();
      toast.success(
        payload.domain?.verifiedAt
          ? 'Verified! Your domain is live.'
          : 'Verification in progress.',
      );
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm(`Remove ${domain.hostname}? Landing pages will stop serving from this hostname.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/account-domains/${domain.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Could not remove domain');
        return;
      }
      onChanged();
      toast.success('Domain removed.');
    } finally {
      setDeleting(false);
    }
  };

  const handleRefreshSsl = async () => {
    if (refreshingSsl) return;
    setRefreshingSsl(true);
    try {
      const res = await fetch(`/api/account-domains/${domain.id}/refresh-ssl`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not check SSL status');
        return;
      }
      onChanged();
      const status = payload.domain?.cloudflareSslStatus;
      if (status === 'active') toast.success('SSL is live!');
      else if (status === 'pending') toast.info('Still provisioning — give it another minute.');
      else if (status === 'failed')
        toast.error('SSL provisioning failed. Re-check DNS or contact support.');
    } finally {
      setRefreshingSsl(false);
    }
  };

  const handleHomeChange = async (nextId: string) => {
    if (updatingHome) return;
    setUpdatingHome(true);
    try {
      const res = await fetch(`/api/account-domains/${domain.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeLandingPageId: nextId === '' ? null : nextId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not update home page');
        return;
      }
      onChanged();
      toast.success('Home page updated.');
    } finally {
      setUpdatingHome(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <GlobeAltIcon className="w-5 h-5 text-[var(--muted-foreground)] flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium truncate">{domain.hostname}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <StatusPill verified={verified} />
              {verified && domain.cloudflareSslStatus && (
                <SslStatusPill
                  status={domain.cloudflareSslStatus}
                  refreshing={refreshingSsl}
                  onRefresh={
                    domain.cloudflareSslStatus === 'pending' ||
                    domain.cloudflareSslStatus === 'failed'
                      ? handleRefreshSsl
                      : undefined
                  }
                />
              )}
              {verified && (
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  since {formatDate(domain.verifiedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!verified && (
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
              {verifying ? 'Checking…' : 'Verify'}
            </button>
          )}
          {verified && (
            <a
              href={`https://${domain.hostname}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-colors"
            >
              Open
            </a>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Remove domain"
            title="Remove"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-rose-400 hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Verified state: show home-page picker. Unverified state: show
          DNS instructions. */}
      {verified ? (
        <div className="border-t border-[var(--border)] pt-4">
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            <HomeIcon className="w-3.5 h-3.5" />
            Home page (served at /)
          </label>
          <select
            value={domain.homeLandingPageId ?? ''}
            onChange={(e) => void handleHomeChange(e.target.value)}
            disabled={updatingHome}
            className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg outline-none focus:border-[var(--primary)] disabled:opacity-50"
          >
            <option value="">— No home page (root URL 404s) —</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (/{p.slug})
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Slugged paths (e.g. <code className="font-mono">{domain.hostname}/spring-sale</code>)
            still resolve regardless of this setting.
          </p>
        </div>
      ) : (
        <DnsInstructions domain={domain} />
      )}
    </div>
  );
}

function StatusPill({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300">
        <CheckCircleIcon className="w-3 h-3" />
        Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300">
      <ExclamationTriangleIcon className="w-3 h-3" />
      Pending DNS
    </span>
  );
}

/**
 * Secondary pill that shows the Cloudflare-side SSL status after the
 * domain is verified. When pending or failed, a small inline refresh
 * button lets the dealer re-poll CF without leaving the page (the
 * status here is whatever was cached at the last verify or refresh —
 * CF cert provisioning typically takes 30–120 seconds after the
 * CNAME starts resolving). Hidden entirely when CF isn't configured
 * server-side (status is null).
 */
function SslStatusPill({
  status,
  refreshing,
  onRefresh,
}: {
  status: 'pending' | 'active' | 'failed';
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  const meta = (() => {
    if (status === 'active') {
      return {
        label: 'SSL active',
        className: 'bg-emerald-500/15 text-emerald-300',
      };
    }
    if (status === 'failed') {
      return {
        label: 'SSL failed',
        className: 'bg-rose-500/15 text-rose-300',
      };
    }
    return {
      label: 'SSL provisioning',
      className: 'bg-amber-500/15 text-amber-300',
    };
  })();
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.className}`}
    >
      <LockClosedIcon className="w-3 h-3" />
      {meta.label}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh SSL status"
          title="Re-check Cloudflare"
          className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded hover:opacity-70 disabled:opacity-40"
        >
          <ArrowPathIcon className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      )}
    </span>
  );
}

// ── DNS instructions panel ─────────────────────────────────────────

function DnsInstructions({ domain }: { domain: AccountDomain }) {
  return (
    <div className="border-t border-[var(--border)] pt-4 space-y-3">
      <p className="text-xs text-[var(--muted-foreground)]">
        Add both records at your DNS provider. The TXT proves you own the domain; the CNAME
        routes visitors to us. DNS changes can take 5–60 minutes to propagate.
      </p>

      <DnsRow
        type="TXT"
        nameLabel="Name / Host"
        name={domain.dns.txtName}
        valueLabel="Value"
        value={domain.dns.txtValue}
      />
      <DnsRow
        type="CNAME"
        nameLabel="Name / Host"
        name={domain.dns.cnameName}
        valueLabel="Points to"
        value={domain.dns.cnameTarget}
      />

      <details className="text-[11px] text-[var(--muted-foreground)]">
        <summary className="cursor-pointer hover:text-[var(--foreground)]">
          About HTTPS
        </summary>
        <p className="mt-1.5 leading-relaxed">
          HTTPS certificates are provisioned automatically once DNS resolves to our edge —
          this can take a few minutes after verification. If you visit{' '}
          <code className="font-mono">https://{domain.hostname}</code> and see a certificate
          warning right after verifying, give it 5–10 minutes.
        </p>
      </details>
    </div>
  );
}

function DnsRow({
  type,
  nameLabel,
  name,
  valueLabel,
  value,
}: {
  type: 'TXT' | 'CNAME';
  nameLabel: string;
  name: string;
  valueLabel: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3 bg-[var(--input)]/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[var(--muted)]">
          {type}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2 text-xs">
        <DnsField label={nameLabel} value={name} />
        <DnsField label={valueLabel} value={value} />
      </div>
    </div>
  );
}

function DnsField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-0.5">
        {label}
      </div>
      <div className="flex items-center gap-1.5 group">
        <code className="font-mono text-xs text-[var(--foreground)] truncate flex-1 min-w-0" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] opacity-60 group-hover:opacity-100 transition-opacity"
        >
          {copied ? (
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <ClipboardIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
