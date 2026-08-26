'use client';

/**
 * Connect / location picker for Business Profile. STAFF ONLY.
 *
 * The page decides whether to render this at all — a `client` user sees the
 * "ask your account manager" message instead, because connecting binds a
 * dealership employee's Google grant and is not theirs to initiate. Rendering
 * it is a convenience gate, not the security boundary: the routes behind it are
 * independently gated on MANAGEMENT_ROLES.
 *
 * Two states in one panel, because they are two steps of one job: connect the
 * Google account, then choose which of its listings this Loomi account reports
 * on. A grant with no location renders nothing, so step two is not optional.
 */

import { useState } from 'react';
import useSWR from 'swr';
import {
  LinkIcon,
  MapPinIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { fetcher, Section, Muted } from '../../ads/_components/shared';
import { Collapse } from '@/components/ui/collapse';

export interface GbpStatus {
  connected: boolean;
  connectedEmail: string | null;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  needsLocation: boolean;
}
interface GbpLocation {
  name: string;
  title: string;
  address: string | null;
}
interface ConnectionResponse {
  status: GbpStatus;
  locations?: GbpLocation[];
  error?: string;
  code?: string;
}

export function GbpConnectPanel({
  accountKey,
  onChanged,
}: {
  accountKey: string;
  /** Bump the report's SWR key once the connection or location changes. */
  onChanged: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Locations cost a Google round trip, so only ask for them while the picker
  // is open.
  const key = `/api/reporting/gbp/connection?accountKey=${encodeURIComponent(accountKey)}${
    pickerOpen ? '&locations=1' : ''
  }`;
  const { data, error, isLoading, mutate } = useSWR<ConnectionResponse>(key, fetcher);

  const status = data?.status;

  async function choose(loc: GbpLocation) {
    setBusy(loc.name);
    setActionError(null);
    try {
      const res = await fetch('/api/reporting/gbp/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, locationId: loc.name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setPickerOpen(false);
      await mutate();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the location.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setActionError(null);
    try {
      const res = await fetch(
        `/api/reporting/gbp/connection?accountKey=${encodeURIComponent(accountKey)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setPickerOpen(false);
      await mutate();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  const connectHref = `/api/reporting/gbp/connect?accountKey=${encodeURIComponent(accountKey)}`;

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />;
  }
  if (error) {
    return (
      <Section title="Google connection" icon={LinkIcon}>
        <Muted>Couldn&rsquo;t read the connection state: {error.message}</Muted>
      </Section>
    );
  }

  return (
    <Section title="Google connection" icon={LinkIcon}>
      {!status?.connected ? (
        <div className="space-y-3">
          <Muted>
            Business Profile insights can only be read by a Google account that manages the listing,
            so this connects to the dealership&rsquo;s own Google account rather than to Oz&rsquo;s.
            Sign in as someone who manages the profile.
          </Muted>
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <LinkIcon className="h-4 w-4" />
            Connect Google Business Profile
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircleIcon className="h-4 w-4 text-emerald-400" />
                <span className="font-medium text-[var(--foreground)]">
                  {status.locationName ?? 'No location chosen'}
                </span>
              </div>
              {status.locationAddress && <Muted>{status.locationAddress}</Muted>}
              {status.connectedEmail && <Muted>Connected as {status.connectedEmail}</Muted>}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--primary)]/40"
              >
                <MapPinIcon className="h-3.5 w-3.5" />
                {status.locationId ? 'Change location' : 'Choose location'}
              </button>
              <a
                href={connectHref}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--primary)]/40"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                Reconnect
              </a>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy === 'disconnect'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500/40 disabled:opacity-50"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </div>

          {status.lastError && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <Muted>
                Last attempt failed: {status.lastError}
                {status.lastErrorAt && ` (${new Date(status.lastErrorAt).toLocaleString()})`}
              </Muted>
            </div>
          )}

          <Collapse open={pickerOpen} unmountOnClose>
            <div className="rounded-lg border border-[var(--border)] p-3">
              {data?.error ? (
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <Muted>{data.error}</Muted>
                </div>
              ) : !data?.locations?.length ? (
                <Muted>
                  This Google account doesn&rsquo;t manage any Business Profile locations. Reconnect
                  with an account that does.
                </Muted>
              ) : (
                <ul className="space-y-1">
                  {data.locations.map((loc) => {
                    const active = status.locationId && loc.name.endsWith(status.locationId);
                    return (
                      <li key={loc.name}>
                        <button
                          type="button"
                          onClick={() => choose(loc)}
                          disabled={!!busy}
                          className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                            active
                              ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                              : 'hover:bg-[var(--muted)]/50'
                          }`}
                        >
                          <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium">{loc.title}</span>
                            {loc.address && (
                              <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                                {loc.address}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Collapse>

          {actionError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <Muted>{actionError}</Muted>
            </div>
          )}

          <Muted>
            Disconnecting only stops Loomi using the access. To revoke it fully, the dealership
            removes Loomi at myaccount.google.com under third-party access.
          </Muted>
        </div>
      )}
    </Section>
  );
}
