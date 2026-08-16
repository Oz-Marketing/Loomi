'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  FunnelIcon,
  GlobeAltIcon,
  InboxStackIcon,
  LockClosedIcon,
  MapIcon,
  PaperAirplaneIcon,
  PhoneIcon,
  PhotoIcon,
  StarIcon,
  TvIcon,
  UserPlusIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon, GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';
import {
  REPORT_GROUP_LABELS,
  reportIntegration,
  type ReportGroup,
  type ReportKey,
} from '@/lib/permissions/reports';
import type { SourceState } from '@/lib/permissions/report-sources';

type ReportRow = {
  key: string;
  label: string;
  group: ReportGroup;
  blurb: string;
  enabled: boolean;
  /** No stored row — this is `defaultForClients` showing through. */
  isDefault: boolean;
  defaultForClients: boolean;
  source: { state: SourceState; detail: string };
};

/** The same switch the Notifications tab uses. */
function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

/**
 * Whether the report has anything behind it for this account.
 *
 * The reason this is on screen: switching a report on doesn't make it work. A
 * dealer whose Meta ad account was never linked gets an empty page, and the
 * person who ticked the box has no way to know until the dealer complains.
 */
function SourceBadge({
  source,
  enabled,
}: {
  source: { state: SourceState; detail: string };
  enabled: boolean;
}) {
  if (source.state === 'builtin') {
    return (
      <span
        title={source.detail}
        className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
      >
        <LockClosedIcon className="h-3 w-3" />
        Built in
      </span>
    );
  }

  if (source.state === 'connected') {
    return (
      <span
        title={source.detail}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
        style={{ background: 'rgba(52,211,153,0.16)', color: '#6ee7b7' }}
      >
        <CheckCircleIcon className="h-3 w-3" />
        Connected
      </span>
    );
  }

  // Missing. Loud only when the report is actually switched on — a disconnected
  // source on a report nobody sees is not a problem to shout about.
  return (
    <span
      title={source.detail}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      style={
        enabled
          ? { background: 'rgba(251,191,36,0.16)', color: '#fcd34d' }
          : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
      }
    >
      <ExclamationTriangleIcon className="h-3 w-3" />
      No data
    </span>
  );
}

/**
 * The "go fix it" affordance on a report that's switched on with nothing behind
 * it.
 *
 * Renders NOTHING when the report has no integration screen — GA4 is mapped
 * agency-wide in env, and reviews/calls/billboards/mail/DMS data is ingested
 * rather than connected. A button that opened the wrong page would imply the
 * fix is one click away when it isn't; the badge and its tooltip already say
 * what's missing.
 */
function FixItButton({
  reportKey,
  onIntegrate,
}: {
  reportKey: ReportKey;
  onIntegrate?: (provider: string) => void;
}) {
  const target = reportIntegration(reportKey);
  if (!target) return null;

  const className =
    'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors';
  const style = {
    borderColor: 'rgba(251,191,36,0.35)',
    color: '#fcd34d',
    background: 'rgba(251,191,36,0.10)',
  };

  if (target.kind === 'link') {
    return (
      <Link href={target.href} className={className} style={style} title={target.label}>
        {target.label}
        <ArrowRightIcon className="h-3 w-3" />
      </Link>
    );
  }

  // No handler means this tab is rendered somewhere that can't open the modal.
  // Better to show nothing than a button that does nothing.
  if (!onIntegrate) return null;

  return (
    <button
      type="button"
      onClick={() => onIntegrate(target.provider)}
      className={className}
      style={style}
      title={target.label}
    >
      {target.label}
      <ArrowRightIcon className="h-3 w-3" />
    </button>
  );
}

/**
 * One icon per report — the SAME ones the client's Reporting sidebar uses, so
 * the row you tick here is visibly the row they get. Meta and Google Ads use
 * their brand marks; the rest reuse the nav's heroicons.
 */
const REPORT_ICON: Record<string, ComponentType<{ className?: string }>> = {
  ads: MetaBrandIcon,
  google: GoogleAdsBrandIcon,
  stackadapt: TvIcon,
  websites: GlobeAltIcon,
  business_profile: BuildingStorefrontIcon,
  reputation: StarIcon,
  call_tracking: PhoneIcon,
  billboards: PhotoIcon,
  contacts: UsersIcon,
  lists: FunnelIcon,
  engagement: PaperAirplaneIcon,
  leads: UserPlusIcon,
  sales_trend: ArrowTrendingUpIcon,
  service_trend: WrenchScrewdriverIcon,
  service_retention: ArrowPathIcon,
  heatmap: MapIcon,
  direct_mail: InboxStackIcon,
};

const GROUP_ORDER: ReportGroup[] = ['advertising', 'presence', 'audience', 'sales'];

export function ReportAccessTab({
  accountKey,
  /**
   * Open a provider's integration modal. Supplied by the sub-account screen,
   * which owns both this tab and the Integrations tab the modal lives in.
   */
  onIntegrate,
}: {
  accountKey: string;
  onIntegrate?: (provider: string) => void;
}) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/reports`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load report access');
      const next: ReportRow[] = data.reports ?? [];
      const on = new Set<string>(next.filter((r) => r.enabled).map((r) => r.key));
      setRows(next);
      setEnabled(on);
      setBaseline(JSON.stringify([...on].sort()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report access');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = JSON.stringify([...enabled].sort()) !== baseline;

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      label: REPORT_GROUP_LABELS[group],
      items: rows.filter((r) => r.group === group),
    })).filter((g) => g.items.length > 0);
  }, [rows]);

  /** Switched on, but nothing behind it — the case worth surfacing up top. */
  const brokenOn = useMemo(
    () => rows.filter((r) => enabled.has(r.key) && r.source.state === 'missing'),
    [rows, enabled],
  );

  const setMany = (keys: string[], on: boolean) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/reports`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: [...enabled] }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setBaseline(JSON.stringify([...enabled].sort()));
      // Re-read so the default markers reflect the rows now written.
      await load();
      toast.success('Report access updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">Loading report access…</p>
    );
  }

  const total = rows.length;
  const on = enabled.size;

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-xs text-[var(--muted-foreground)]">
        Which reports this sub-account&apos;s <strong className="font-semibold">client
        users</strong> see in their sidebar. Agency staff always see every report
        their role allows, whatever is set here. Budget and Executive are never
        client-visible and don&apos;t appear below.
      </p>

      {/* Summary + bulk actions — mirrors the Notifications tab header. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-auto text-[11px] tabular-nums text-[var(--muted-foreground)]">
          {on} of {total} visible to clients
        </span>
        <button
          type="button"
          onClick={() => setMany(rows.map((r) => r.key), true)}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setMany(rows.map((r) => r.key), false)}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          None
        </button>
        {/* The useful bulk action: match what this dealer actually has data for. */}
        <button
          type="button"
          onClick={() =>
            setEnabled(
              new Set(
                rows.filter((r) => r.source.state !== 'missing').map((r) => r.key),
              ),
            )
          }
          title="Switch on every report that has a working data source, and switch off the rest"
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          Match connected
        </button>
      </div>

      {brokenOn.length > 0 && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5"
          style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)' }}
        >
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#fcd34d' }} />
          <p className="text-xs text-[var(--foreground)]">
            <strong className="font-semibold">
              {brokenOn.length} report{brokenOn.length === 1 ? '' : 's'} will be empty.
            </strong>{' '}
            {brokenOn.map((r) => r.label).join(', ')}{' '}
            {brokenOn.length === 1 ? 'is' : 'are'} switched on but{' '}
            {brokenOn.length === 1 ? 'has' : 'have'} no data source connected for
            this sub-account. Clients will see the page with nothing in it.
          </p>
        </div>
      )}

      {on === 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5">
          <EyeSlashIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs text-[var(--muted-foreground)]">
            Client users on this sub-account will see no reports at all — their
            Reporting sidebar will be empty.
          </p>
        </div>
      )}

      <div className="space-y-5">
        {grouped.map(({ group, label, items }) => {
          const groupOn = items.filter((r) => enabled.has(r.key)).length;
          return (
            <div key={group}>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {label}
                </h4>
                <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                  {groupOn}/{items.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setMany(items.map((r) => r.key), groupOn !== items.length)
                  }
                  className="ml-auto text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  {groupOn === items.length ? 'Turn all off' : 'Turn all on'}
                </button>
              </div>

              <div className="space-y-2">
                {items.map((row) => {
                  const isOn = enabled.has(row.key);
                  return (
                    <div
                      key={row.key}
                      className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5 transition-colors"
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]"
                      >
                        {(() => {
                          const Icon = REPORT_ICON[row.key] ?? ChartBarIcon;
                          return (
                            <Icon
                              className={`h-4 w-4 ${
                                // Brand marks carry their own colour; the
                                // heroicons need one.
                                row.key === 'ads' || row.key === 'google'
                                  ? ''
                                  : 'text-[var(--muted-foreground)]'
                              }`}
                            />
                          );
                        })()}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">
                            {row.label}
                          </span>
                          <SourceBadge source={row.source} enabled={isOn} />
                          {row.isDefault && (
                            <span
                              title={`No setting saved for this sub-account, so it follows the platform default (${
                                row.defaultForClients ? 'shown' : 'hidden'
                              }). Saving writes an explicit choice.`}
                              className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"
                            >
                              default
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          {row.blurb}
                          {row.source.state !== 'builtin' && (
                            <span className="opacity-70"> · {row.source.detail}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">
                        {isOn && row.source.state === 'missing' && (
                          <FixItButton
                            reportKey={row.key as ReportKey}
                            onIntegrate={onIntegrate}
                          />
                        )}
                        <ToggleSwitch
                          checked={isOn}
                          onChange={() => setMany([row.key], !isOn)}
                          label={`Show ${row.label} to client users`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save Report Access'}
        </PrimaryButton>
        {dirty && (
          <span className="text-xs text-[var(--muted-foreground)]">
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
