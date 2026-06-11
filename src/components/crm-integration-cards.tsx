'use client';

/**
 * CRM integration cards for the account Integrations grid — one card per
 * supported CRM, styled like the Meta Ads card. Two kinds:
 *
 *   • ADF email (Tekion, VinSolutions) — connect by entering the CRM's
 *     ADF lead-intake email; leads are emailed there as ADF/XML.
 *   • API (HubSpot) — connect with a Private App token; qualified contacts
 *     are upserted into HubSpot over its REST API.
 *
 * Clicking a card opens a modal to connect, test, toggle on/off, view recent
 * deliveries, or disconnect. Renders the card <button>s as a fragment so they
 * flow into the existing integrations grid alongside Meta Ads, plus a portal
 * modal.
 *
 * Forwarding is opt-in: a form's "Forward leads to CRM" toggle (ADF), or a
 * "Push to CRM" step in a flow (HubSpot) — these cards only configure the
 * destination.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ArrowPathIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

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
  leadEmails: string[];
  // API providers (hubspot): whether a token is stored + non-secret config.
  connected?: boolean;
  portalId?: string | null;
  config?: Record<string, unknown> | null;
  enabled: boolean;
  recentDeliveries: DeliveryRow[];
}

interface ProviderMeta {
  value: string;
  label: string;
  blurb: string;
  kind: 'adf' | 'api';
  /** Hosted logo URL. Empty → a text fallback is rendered (see LogoBox). */
  logo: string;
  /** Brand tint used by the text fallback when there's no hosted logo. */
  accent?: string;
  /** Banner background behind the logo. Defaults to white; set a dark value
   *  for white/knockout logos (e.g. Tecobi) that would vanish on white. */
  logoBg?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    value: 'tekion',
    label: 'Tekion',
    blurb: 'Forward form leads into Tekion ARC.',
    kind: 'adf',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/7a452ef16a8a428ea19c6cd5fc16d245/tekion_logo.jpg',
  },
  {
    value: 'vinsolutions',
    label: 'VinSolutions',
    blurb: 'Forward form leads into VinSolutions.',
    kind: 'adf',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/c4be6d0fe861482ea4b045ed02e299d7/vinsolutions_logo.png',
  },
  {
    value: 'elead',
    label: 'Elead (CDK)',
    blurb: 'Forward form leads into Elead / CDK.',
    kind: 'adf',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/e8e91129ebe04f1fab29fc48799304ce/eLead1.png',
    accent: '#0b6efd',
  },
  {
    value: 'tecobi',
    label: 'Tecobi',
    blurb: 'Forward form leads into Tecobi.',
    kind: 'adf',
    // White/knockout logo — render on a dark banner so it's visible.
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/438d2f28ff354cdb9bdc65958b39a2f1/branding_tecobi_white.svg',
    logoBg: '#111827',
    accent: '#6d28d9',
  },
  {
    value: 'psx',
    label: 'PSX',
    blurb: 'Forward form leads into PSX / CXMAi.',
    kind: 'adf',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/be00bffddd3c417bb100e0602a7dddb4/PSXD_Full-Style1.png',
    accent: '#0891b2',
  },
  {
    value: 'hubspot',
    label: 'HubSpot',
    blurb: 'Push qualified leads into HubSpot as contacts.',
    kind: 'api',
    logo: 'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/55ba011e8325429c9d890c408cdb371a/HubSpot_Logo.svg.png',
    // Brand tint kept as the text fallback if the hosted logo ever 404s.
    accent: '#ff7a59',
  },
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

const ADF_META = PROVIDERS.filter((p) => p.kind === 'adf');
const API_META = PROVIDERS.filter((p) => p.kind === 'api');

export function CrmIntegrationCards({ accountKey }: { accountKey: string }) {
  const listUrl = `/api/accounts/${encodeURIComponent(accountKey)}/crm`;
  const { data, mutate } = useSWR<{ destinations: Destination[] }>(listUrl, fetcher);
  // active is either '__adf__' (the consolidated ADF card) or an API
  // provider's value (its own card), or null when no modal is open.
  const [active, setActive] = React.useState<string | null>(null);

  const byProvider = new Map((data?.destinations ?? []).map((d) => [d.provider, d]));

  // The single ADF card represents every ADF CRM (Tekion, VinSolutions,
  // Elead, Tecobi). A dealer usually uses one, so a single card keeps the
  // grid clean as more ADF CRMs are added.
  const connectedAdf = ADF_META.filter((p) => byProvider.get(p.value)?.enabled);
  // When exactly one ADF CRM is connected, the card adopts that CRM's
  // identity (logo + name); 0 or 2+ keep the generic "CRM Lead Routing" look.
  const soleAdf = connectedAdf.length === 1 ? connectedAdf[0] : null;
  const activeApi = API_META.find((p) => p.value === active) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setActive('__adf__')}
        className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)] hover:shadow-md"
      >
        {soleAdf ? (
          <div
            className="flex h-28 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
            style={{ background: soleAdf.logoBg ?? '#ffffff' }}
          >
            <LogoBox logo={soleAdf.logo} label={soleAdf.label} accent={soleAdf.accent} />
          </div>
        ) : (
          <div
            className="flex h-28 w-full items-center justify-center border-b border-[var(--border)]"
            style={{ background: 'linear-gradient(135deg,#0f172a,#4338ca)' }}
          >
            <span className="text-xl font-bold tracking-tight text-white">CRM Lead Routing</span>
          </div>
        )}
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[var(--foreground)]">
              {soleAdf ? soleAdf.label : 'CRM Lead Routing'}
            </span>
            <ConnectionPill connected={connectedAdf.length > 0} />
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {soleAdf
              ? `Forwarding form leads to ${soleAdf.label}.`
              : connectedAdf.length > 1
                ? `${connectedAdf.length} CRMs connected.`
                : 'Forward form leads to the dealer’s CRM (Tekion, VinSolutions, Elead, Tecobi, PSX).'}
          </p>
        </div>
      </button>

      {API_META.map((p) => {
        const connected = Boolean(byProvider.get(p.value)?.enabled);
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => setActive(p.value)}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)] hover:shadow-md"
          >
            <div
              className="flex h-28 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
              style={{ background: p.logoBg ?? '#ffffff' }}
            >
              <LogoBox logo={p.logo} label={p.label} accent={p.accent} />
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

      {active === '__adf__' &&
        createPortal(
          <AdfCardModal
            accountKey={accountKey}
            byProvider={byProvider}
            onClose={() => setActive(null)}
            onChanged={() => void mutate()}
          />,
          document.body,
        )}

      {activeApi &&
        createPortal(
          <HubspotModal
            accountKey={accountKey}
            label={activeApi.label}
            logo={activeApi.logo}
            accent={activeApi.accent}
            logoBg={activeApi.logoBg}
            destination={byProvider.get(activeApi.value) ?? null}
            onClose={() => setActive(null)}
            onChanged={() => void mutate()}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * Modal behind the single ADF "CRM Lead Routing" card. A provider picker
 * selects which ADF CRM to configure; the body is the existing per-provider
 * email form (ProviderModal), re-mounted per provider via `key` so its email
 * state resets cleanly on switch. The picker marks already-connected CRMs.
 */
function AdfCardModal({
  accountKey,
  byProvider,
  onClose,
  onChanged,
}: {
  accountKey: string;
  byProvider: Map<string, Destination>;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Default to the first connected ADF CRM, else the first in the list.
  const firstConnected = ADF_META.find((p) => byProvider.get(p.value));
  const [selected, setSelected] = React.useState((firstConnected ?? ADF_META[0]).value);
  const meta = ADF_META.find((p) => p.value === selected) ?? ADF_META[0];

  const picker = (
    <label className="block">
      <span className="text-sm font-medium">CRM</span>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
      >
        {ADF_META.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
            {byProvider.get(p.value)?.enabled ? ' — Connected' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <ProviderModal
      key={selected}
      accountKey={accountKey}
      provider={selected}
      label={meta.label}
      logo={meta.logo}
      accent={meta.accent}
      logoBg={meta.logoBg}
      destination={byProvider.get(selected) ?? null}
      picker={picker}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

/** Logo header content: the hosted image, or a branded text fallback when
 *  no logo URL is set (used for HubSpot until a logo is hosted on Spaces). */
function LogoBox({
  logo,
  label,
  accent,
  max = 'max-h-12',
}: {
  logo: string;
  label: string;
  accent?: string;
  max?: string;
}) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${label} logo`}
        loading="lazy"
        className={`${max} w-auto max-w-[75%] object-contain`}
      />
    );
  }
  return (
    <span className="text-2xl font-bold tracking-tight" style={{ color: accent ?? '#111827' }}>
      {label}
    </span>
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
  logo,
  accent,
  logoBg,
  destination,
  picker,
  onClose,
  onChanged,
}: {
  accountKey: string;
  provider: string;
  label: string;
  logo: string;
  accent?: string;
  logoBg?: string;
  destination: Destination | null;
  /** Optional provider picker rendered above the form (set by AdfCardModal
   *  so one card can configure any ADF CRM). */
  picker?: React.ReactNode;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [emails, setEmails] = React.useState<string[]>(
    destination?.leadEmails?.length ? destination.leadEmails : [''],
  );
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const crmBase = `/api/accounts/${encodeURIComponent(accountKey)}/crm`;

  const cleanEmails = emails.map((e) => e.trim()).filter(Boolean);
  const updateEmail = (i: number, v: string) =>
    setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));
  const addEmail = () => setEmails((prev) => [...prev, '']);
  const removeEmail = (i: number) =>
    setEmails((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (busy || cleanEmails.length === 0) return;
    setBusy(true);
    try {
      // Existing destination → PATCH (and re-enable); otherwise create.
      const res = destination
        ? await fetch(`${crmBase}/${destination.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadEmails: cleanEmails, enabled: true }),
          })
        : await fetch(crmBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, leadEmails: cleanEmails }),
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
      if (payload.ok)
        toast.success(
          payload.sentTo
            ? `Test lead sent to ${payload.sentTo} — check the CRM inbox.`
            : 'Test lead sent — check the CRM inbox.',
        );
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
        <div
          className="relative flex h-28 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
          style={{ background: logoBg ?? '#ffffff' }}
        >
          <LogoBox logo={logo} label={label} accent={accent} max="max-h-14" />
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

          {picker ? <div className="mb-4">{picker}</div> : null}

          <div className="block">
            <span className="text-sm font-medium">Lead-intake emails</span>
            <div className="mt-1 space-y-2">
              {emails.map((email, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => updateEmail(i, e.target.value)}
                    placeholder={`leads@${provider}.example.com`}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeEmail(i)}
                    disabled={emails.length === 1}
                    aria-label="Remove email"
                    className="flex-shrink-0 rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-rose-500/40 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addEmail}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add another email
            </button>
            <span className="mt-2 block text-[11px] text-[var(--muted-foreground)]">
              These are the lead addresses your CRM provides for inbound ADF — not people&apos;s inboxes.
              Each one gets a copy of every forwarded lead.
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || cleanEmails.length === 0}
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

function HubspotModal({
  accountKey,
  label,
  logo,
  accent,
  logoBg,
  destination,
  onClose,
  onChanged,
}: {
  accountKey: string;
  label: string;
  logo: string;
  accent?: string;
  logoBg?: string;
  destination: Destination | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const cfg = (destination?.config ?? {}) as Record<string, unknown>;
  const [token, setToken] = React.useState('');
  const [portalId, setPortalId] = React.useState(destination?.portalId ?? '');
  const [createDeal, setCreateDeal] = React.useState(
    Boolean(cfg.pipelineId && cfg.stageId),
  );
  const [pipelineId, setPipelineId] = React.useState(String(cfg.pipelineId ?? ''));
  const [stageId, setStageId] = React.useState(String(cfg.stageId ?? ''));
  const [dealNamePrefix, setDealNamePrefix] = React.useState(String(cfg.dealNamePrefix ?? ''));
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const crmBase = `/api/accounts/${encodeURIComponent(accountKey)}/crm`;

  // A token is already stored server-side (it's never returned). When set,
  // the field is optional on save — blank means "keep the stored token".
  const hasStoredToken = Boolean(destination?.connected);
  const connected = Boolean(destination?.enabled);
  const canSave = hasStoredToken || token.trim().length > 0;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buildConfig = (): Record<string, unknown> => {
    if (createDeal) {
      return {
        pipelineId: pipelineId.trim(),
        stageId: stageId.trim(),
        ...(dealNamePrefix.trim() ? { dealNamePrefix: dealNamePrefix.trim() } : {}),
      };
    }
    // Empty config clears any previously-set deal settings.
    return {};
  };

  const save = async () => {
    if (busy || !canSave) return;
    if (createDeal && (!pipelineId.trim() || !stageId.trim())) {
      toast.error('Pipeline ID and stage ID are required to create a deal.');
      return;
    }
    setBusy(true);
    try {
      const config = buildConfig();
      const portal = portalId.trim() || null;
      const res = destination
        ? await fetch(`${crmBase}/${destination.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: true,
              portalId: portal,
              config,
              ...(token.trim() ? { accessToken: token.trim() } : {}),
            }),
          })
        : await fetch(crmBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: 'hubspot',
              accessToken: token.trim(),
              portalId: portal,
              config,
            }),
          });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not save');
        return;
      }
      setToken('');
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
    if (!window.confirm(`Disconnect ${label}? Qualified leads will stop syncing here.`)) return;
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

  const testConnection = async () => {
    if (!destination || testing) return;
    setTesting(true);
    try {
      const res = await fetch(`${crmBase}/${destination.id}/test`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (payload.ok) toast.success('HubSpot connection looks good.');
      else toast.error(payload.error ? `Test failed: ${payload.error}` : 'Test failed');
    } catch {
      toast.error('Network error — please retry.');
    } finally {
      setTesting(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

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
        <div
          className="relative flex h-28 w-full items-center justify-center border-b border-[var(--border)] px-8 py-6"
          style={{ background: logoBg ?? '#ffffff' }}
        >
          <LogoBox logo={logo} label={label} accent={accent} max="max-h-14" />
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
            Connect a HubSpot{' '}
            <span className="font-medium text-[var(--foreground)]">Private App</span> with the{' '}
            <code className="text-xs">crm.objects.contacts</code> scope. A{' '}
            <span className="font-medium text-[var(--foreground)]">Push to CRM</span> step in a flow
            (or a form with forwarding on) upserts the contact into HubSpot by email.
          </p>

          <label className="block">
            <span className="text-sm font-medium">Private App access token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasStoredToken ? '•••••••• stored — leave blank to keep' : 'pat-na1-xxxxxxxx-xxxx-…'}
              autoComplete="off"
              spellCheck={false}
              className={`mt-1 font-mono ${inputCls}`}
            />
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-medium">
              Portal ID <span className="text-[var(--muted-foreground)]">(optional)</span>
            </span>
            <input
              type="text"
              value={portalId}
              onChange={(e) => setPortalId(e.target.value)}
              placeholder="e.g. 12345678"
              autoComplete="off"
              spellCheck={false}
              className={`mt-1 ${inputCls}`}
            />
          </label>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={createDeal}
              onChange={(e) => setCreateDeal(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            <span className="text-sm font-medium">Also create a deal on push</span>
          </label>

          {createDeal && (
            <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3">
              <label className="block">
                <span className="text-xs font-medium">Pipeline ID</span>
                <input
                  type="text"
                  value={pipelineId}
                  onChange={(e) => setPipelineId(e.target.value)}
                  placeholder="default"
                  className={`mt-1 ${inputCls}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Stage ID</span>
                <input
                  type="text"
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  placeholder="appointmentscheduled"
                  className={`mt-1 ${inputCls}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">
                  Deal name prefix <span className="text-[var(--muted-foreground)]">(optional)</span>
                </span>
                <input
                  type="text"
                  value={dealNamePrefix}
                  onChange={(e) => setDealNamePrefix(e.target.value)}
                  placeholder="New consultation"
                  className={`mt-1 ${inputCls}`}
                />
              </label>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Find pipeline + stage IDs in HubSpot under Settings → Objects → Deals → Pipelines.
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !canSave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : destination ? 'Save' : 'Connect'}
            </button>
            {destination && (
              <>
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Testing…' : 'Test connection'}
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
