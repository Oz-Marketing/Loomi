'use client';

/**
 * CRM integration cards for the account Integrations grid — one card per
 * supported CRM (Tekion, VinSolutions), styled like the Meta Ads card.
 * Clicking a card opens a modal to connect the CRM (enter its ADF
 * lead-intake email), send a test lead, toggle it on/off, view recent
 * deliveries, or disconnect.
 *
 * Renders the two card <button>s as a fragment so they flow into the
 * existing integrations grid alongside Meta Ads, plus a portal modal.
 *
 * Forwarding is opt-in per form (the form's "Forward leads to CRM"
 * toggle) — these cards only configure the destination.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ArrowPathIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface DeliveryRow {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

interface Destination {
  id: string;
  provider: string;
  leadEmail: string;
  enabled: boolean;
  recentDeliveries: DeliveryRow[];
}

const PROVIDERS: { value: string; label: string; blurb: string; banner: string }[] = [
  {
    value: 'tekion',
    label: 'Tekion',
    blurb: 'Forward form leads into Tekion ARC.',
    banner: 'linear-gradient(135deg,#0b1b3a,#1e3a8a)',
  },
  {
    value: 'vinsolutions',
    label: 'VinSolutions',
    blurb: 'Forward form leads into VinSolutions.',
    banner: 'linear-gradient(135deg,#7c2d12,#b91c1c)',
  },
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export function CrmIntegrationCards({ accountKey }: { accountKey: string }) {
  const listUrl = `/api/accounts/${encodeURIComponent(accountKey)}/crm`;
  const { data, mutate } = useSWR<{ destinations: Destination[] }>(listUrl, fetcher);
  const [active, setActive] = React.useState<string | null>(null);

  const byProvider = new Map((data?.destinations ?? []).map((d) => [d.provider, d]));
  const activeMeta = PROVIDERS.find((p) => p.value === active) ?? null;

  return (
    <>
      {PROVIDERS.map((p) => {
        const dest = byProvider.get(p.value);
        const connected = Boolean(dest?.enabled);
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => setActive(p.value)}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)] hover:shadow-md"
          >
            <div
              className="flex h-28 w-full items-center justify-center border-b border-[var(--border)]"
              style={{ background: p.banner }}
            >
              <span className="text-xl font-bold tracking-tight text-white">{p.label}</span>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--foreground)]">{p.label}</span>
                <ConnectionPill connected={connected} />
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{p.blurb}</p>
            </div>
          </button>
        );
      })}

      {activeMeta &&
        createPortal(
          <ProviderModal
            accountKey={accountKey}
            provider={activeMeta.value}
            label={activeMeta.label}
            banner={activeMeta.banner}
            destination={byProvider.get(activeMeta.value) ?? null}
            onClose={() => setActive(null)}
            onChanged={() => void mutate()}
          />,
          document.body,
        )}
    </>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium"
      style={{ color: connected ? '#22c55e' : 'var(--muted-foreground)' }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: connected ? '#22c55e' : 'var(--muted-foreground)' }}
      />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}

function ProviderModal({
  accountKey,
  provider,
  label,
  banner,
  destination,
  onClose,
  onChanged,
}: {
  accountKey: string;
  provider: string;
  label: string;
  banner: string;
  destination: Destination | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [leadEmail, setLeadEmail] = React.useState(destination?.leadEmail ?? '');
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const crmBase = `/api/accounts/${encodeURIComponent(accountKey)}/crm`;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (busy || !leadEmail.trim()) return;
    setBusy(true);
    try {
      // Existing destination → PATCH (and re-enable); otherwise create.
      const res = destination
        ? await fetch(`${crmBase}/${destination.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadEmail: leadEmail.trim(), enabled: true }),
          })
        : await fetch(crmBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, leadEmail: leadEmail.trim() }),
          });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not save');
        return;
      }
      onChanged();
      toast.success(`${label} connected.`);
    } catch {
      toast.error('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    if (!destination || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${crmBase}/${destination.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || 'Update failed');
        return;
      }
      onChanged();
    } catch {
      toast.error('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!destination || busy) return;
    if (!window.confirm(`Disconnect ${label}? Leads will stop forwarding here.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${crmBase}/${destination.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || 'Could not disconnect');
        return;
      }
      onChanged();
      onClose();
      toast.success(`${label} disconnected.`);
    } catch {
      toast.error('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!destination || testing) return;
    setTesting(true);
    try {
      const res = await fetch(`${crmBase}/${destination.id}/test`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (payload.ok) toast.success('Test lead sent — check the CRM inbox.');
      else toast.error(payload.error ? `Test failed: ${payload.error}` : 'Test failed');
    } catch {
      toast.error('Network error — please retry.');
    } finally {
      setTesting(false);
    }
  };

  const connected = Boolean(destination?.enabled);

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-modal w-[560px] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex h-28 w-full items-center justify-center" style={{ background: banner }}>
          <span className="text-2xl font-bold tracking-tight text-white">{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-[var(--foreground)]">{label}</h3>
            <ConnectionPill connected={connected} />
          </div>

          <p className="mt-2 mb-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
            Enter the ADF lead-intake email {label} issued for this dealer. Leads from forms with{' '}
            <span className="font-medium text-[var(--foreground)]">Forward leads to CRM</span> turned
            on are emailed there as ADF/XML. We retry with backoff if delivery fails.
          </p>

          <label className="block">
            <span className="text-sm font-medium">Lead-intake email</span>
            <input
              type="email"
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
              placeholder={`leads@${provider}.example.com`}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--primary)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
              This is the lead address your CRM provides for inbound ADF — not a person&apos;s inbox.
            </span>
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !leadEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : destination ? 'Save' : 'Connect'}
            </button>
            {destination && (
              <>
                <button
                  type="button"
                  onClick={sendTest}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Sending…' : 'Send test'}
                </button>
                <button
                  type="button"
                  onClick={() => void setEnabled(!destination.enabled)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  {destination.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <TrashIcon className="w-4 h-4" />
                  Disconnect
                </button>
              </>
            )}
          </div>

          {destination && <DeliveriesLog deliveries={destination.recentDeliveries} />}
        </div>
      </div>
    </div>
  );
}

function DeliveriesLog({ deliveries }: { deliveries: DeliveryRow[] }) {
  if (deliveries.length === 0) {
    return (
      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <p className="text-[11px] text-[var(--muted-foreground)]">No leads forwarded yet.</p>
      </div>
    );
  }
  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Recent deliveries
      </p>
      <div className="space-y-1">
        {deliveries.map((d) => {
          const color = d.status === 'sent' ? '#22c55e' : d.status === 'failed' ? '#f43f5e' : '#f59e0b';
          return (
            <div key={d.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} />
                <span className="whitespace-nowrap text-[var(--muted-foreground)]">{formatDateTime(d.createdAt)}</span>
                {d.lastError && (
                  <span className="truncate text-rose-400" title={d.lastError}>
                    {d.lastError}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap capitalize text-[var(--muted-foreground)]">
                {d.status}
                {d.attempts > 1 && ` · ${d.attempts} tries`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
