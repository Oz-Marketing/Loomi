'use client';

/**
 * Reporting integration cards for the account Integrations grid — one card per
 * ad-reporting platform that stores PER-ACCOUNT settings (StackAdapt, Google
 * Ads, GoHighLevel). Mirrors the CRM cards: click → modal to enter the
 * platform's account id + reporting margin (or, for GHL, a Private Integration
 * token + location id), save, or disconnect.
 *
 * The agency-wide API tokens live in env; these cards only capture which
 * advertiser/customer/location each sub-account maps to, plus its margin.
 * (Meta's ad-account id + margin live on the existing Meta Ads card.)
 *
 * Everything saves through PATCH /api/accounts/[key]; the GHL token is
 * encrypted server-side and never returned (the API exposes `ghlConfigured`).
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';

type FieldType = 'text' | 'margin' | 'secret';

interface FieldSpec {
  key: string;
  type: FieldType;
  label: string;
  placeholder: string;
  help?: string;
}

interface ReportingProvider {
  value: string;
  label: string;
  blurb: string;
  /** Hosted brand-logo URL, shown large on a white panel (like the CRM cards). */
  logo: string;
  /** Account field whose presence marks the card "connected". */
  connectedKey: string;
  fields: FieldSpec[];
}

const MARGIN_HELP = 'Billed cost = actual ÷ (1 − margin/100). Blank = bill at face value.';

const PROVIDERS: ReportingProvider[] = [
  {
    value: 'stackadapt',
    label: 'StackAdapt',
    blurb: 'OTT / CTV reporting — link this dealer’s advertiser.',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/5edb0c5d9209454294c9f7e5516fbb16/StackAdapt_Logo_StackAdapt_Logo+Wordmark_500px.jpg',
    connectedKey: 'stackadaptAdvertiserId',
    fields: [
      { key: 'stackadaptAdvertiserId', type: 'text', label: 'Advertiser ID', placeholder: '105923' },
      { key: 'stackadaptMargin', type: 'margin', label: 'Reporting margin (%)', placeholder: '23', help: MARGIN_HELP },
    ],
  },
  {
    value: 'google',
    label: 'Google Ads',
    blurb: 'Search / Display / PMax reporting — link the customer id.',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/d0ee5bb79ca64c9d8a6f6a0b630716c3/6833828b-02f8-4d53-8223-523905b49da9.png',
    connectedKey: 'googleAdsCustomerId',
    fields: [
      { key: 'googleAdsCustomerId', type: 'text', label: 'Customer ID', placeholder: '2849021739', help: 'Digits only (dashes are fine).' },
      { key: 'googleAdsMargin', type: 'margin', label: 'Reporting margin (%)', placeholder: '23', help: MARGIN_HELP },
    ],
  },
  {
    value: 'gohighlevel',
    label: 'GoHighLevel',
    blurb: 'Email campaign reporting — Private Integration token.',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/0aae9fac5ab446939b4cb254004784e5/e3613822-6cb4-4e85-ba10-9abcb3782b6b.png',
    connectedKey: 'ghlConfigured',
    fields: [
      { key: 'ghlApiKey', type: 'secret', label: 'Private Integration token', placeholder: 'pit-…', help: 'Stored encrypted. Leave blank to keep the current token.' },
      { key: 'ghlLocationId', type: 'text', label: 'Location ID', placeholder: 'RCXFPnyOmtNw1ZHJhq5a' },
    ],
  },
];

interface AccountReporting {
  stackadaptAdvertiserId?: string | null;
  stackadaptMargin?: number | null;
  googleAdsCustomerId?: string | null;
  googleAdsMargin?: number | null;
  ghlLocationId?: string | null;
  ghlConfigured?: boolean;
  [k: string]: unknown;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export function ReportingIntegrationCards({ accountKey }: { accountKey: string }) {
  const url = `/api/accounts/${encodeURIComponent(accountKey)}`;
  const { data, mutate } = useSWR<AccountReporting>(url, fetcher);
  const [active, setActive] = React.useState<string | null>(null);

  const activeMeta = PROVIDERS.find((p) => p.value === active) ?? null;
  const isConnected = (p: ReportingProvider) => Boolean(data?.[p.connectedKey]);

  return (
    <>
      {PROVIDERS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => setActive(p.value)}
          className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)] hover:shadow-md"
        >
          <div
            className="flex h-28 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
            style={{ background: '#ffffff' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.logo}
              alt={`${p.label} logo`}
              loading="lazy"
              className="max-h-12 w-auto max-w-[75%] object-contain"
            />
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[var(--foreground)]">{p.label}</span>
              <ConnectionPill connected={isConnected(p)} />
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{p.blurb}</p>
          </div>
        </button>
      ))}

      {activeMeta &&
        createPortal(
          <ProviderModal
            accountKey={accountKey}
            provider={activeMeta}
            account={data ?? {}}
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
  account,
  onClose,
  onChanged,
}: {
  accountKey: string;
  provider: ReportingProvider;
  account: AccountReporting;
  onClose: () => void;
  onChanged: () => void;
}) {
  const initial = React.useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of provider.fields) {
      // Secrets are never returned — start blank (placeholder shows connected).
      const raw = f.type === 'secret' ? '' : account[f.key];
      v[f.key] = raw === null || raw === undefined ? '' : String(raw);
    }
    return v;
  }, [provider, account]);

  const [values, setValues] = React.useState<Record<string, string>>(initial);
  const [busy, setBusy] = React.useState(false);
  const connected = Boolean(account[provider.connectedKey]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The "primary" field (id / token) must be present to save.
  const primary = provider.fields[0];
  const canSave =
    primary.type === 'secret'
      ? connected || values[primary.key].trim() !== '' // already-set token can stay
      : values[primary.key].trim() !== '';

  const patch = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not save');
        return false;
      }
      onChanged();
      toast.success(successMsg);
      return true;
    } catch {
      toast.error('Network error — please retry.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || !canSave) return;
    const body: Record<string, unknown> = {};
    for (const f of provider.fields) {
      const v = (values[f.key] ?? '').trim();
      // A blank secret means "keep the current token" → don't send it.
      if (f.type === 'secret' && v === '') continue;
      body[f.key] = v;
    }
    if (await patch(body, `${provider.label} saved.`)) onClose();
  };

  const disconnect = async () => {
    if (busy) return;
    if (!window.confirm(`Disconnect ${provider.label} reporting for this account?`)) return;
    const body: Record<string, unknown> = {};
    for (const f of provider.fields) body[f.key] = '';
    if (await patch(body, `${provider.label} disconnected.`)) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="glass-modal w-[520px] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div
          className="relative flex h-24 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
          style={{ background: '#ffffff' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={provider.logo}
            alt={`${provider.label} logo`}
            className="max-h-10 w-auto max-w-[70%] object-contain"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-[var(--foreground)]">{provider.label}</h3>
            <ConnectionPill connected={connected} />
          </div>
          <p className="mt-2 mb-5 text-sm leading-relaxed text-[var(--muted-foreground)]">{provider.blurb}</p>

          <div className="space-y-4">
            {provider.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="text-sm font-medium">{f.label}</span>
                <input
                  type={f.type === 'secret' ? 'password' : 'text'}
                  inputMode={f.type === 'margin' ? 'decimal' : undefined}
                  value={values[f.key]}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (f.type === 'margin' && v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                    setValues((prev) => ({ ...prev, [f.key]: v }));
                  }}
                  placeholder={f.type === 'secret' && connected ? '•••••••• (saved)' : f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--primary)]"
                />
                {f.help && <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{f.help}</span>}
              </label>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !canSave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : connected ? 'Save' : 'Connect'}
            </button>
            {connected && (
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
