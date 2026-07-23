'use client';

/**
 * Organization report roll-up — the org-mode counterpart to the single-account
 * platform reports. Reporting routes are single-account, so this fans out one
 * request per child rooftop (mirroring the contacts-page precedent), then
 * renders org totals (KPI cards) over a per-rooftop benchmarking table.
 *
 * Descriptor-driven: each platform supplies a `RollupConfig` (route + how to
 * pull its flat metric object + which metrics to show). Aggregation math lives
 * in the pure, unit-tested `@/lib/reporting/rollup`.
 */

import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react';
import { BuildingOffice2Icon, ChartBarIcon, LinkSlashIcon, InboxStackIcon } from '@heroicons/react/24/outline';
import {
  Kpi,
  Section,
  DataTable,
  EmptyState,
  LoadingState,
  Muted,
} from '../ads/_components/shared';
import {
  aggregateMetric,
  rooftopMetricValue,
  hasAnyActivity,
  type RollupMetric,
  type RooftopRow,
} from '@/lib/reporting/rollup';

/** A roll-up metric plus its presentation (icon/tone for the KPI card). */
export type RollupMetricUI = RollupMetric & {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: 'primary' | 'emerald' | 'sky' | 'violet' | 'amber' | 'zinc';
};

export interface RollupConfig {
  /** Platform label, e.g. "Meta". */
  label: string;
  /** Single-account route, e.g. "/api/reporting/ads". */
  route: string;
  /** Whether the route takes start_date/end_date (reputation does not). */
  supportsDates?: boolean;
  /** Whether the route takes compare_to. */
  supportsCompare?: boolean;
  /** Pull the flat base-metrics object out of the route response. */
  extract: (data: unknown) => Record<string, number> | null;
  /** KPI cards + per-rooftop table columns (in order). */
  metrics: RollupMetricUI[];
}

const TONES: RollupMetricUI['tone'][] = ['primary', 'sky', 'violet', 'emerald', 'amber', 'zinc'];

export function OrgReportRollup({
  config,
  accountKeys,
  dealers,
  from,
  to,
  compareTo,
}: {
  config: RollupConfig;
  accountKeys: string[];
  dealers: Record<string, string>;
  from: string;
  to: string;
  compareTo: string;
}) {
  const [rows, setRows] = useState<RooftopRow[] | null>(null);

  const keysSig = [...accountKeys].sort().join(',');
  const supportsDates = config.supportsDates !== false;
  const paramSig = supportsDates ? `${from}|${to}|${config.supportsCompare ? compareTo : ''}` : '';
  const sig = `${config.route}|${keysSig}|${paramSig}`;

  useEffect(() => {
    const keys = keysSig ? keysSig.split(',') : [];
    if (keys.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setRows(null);

    const params = supportsDates
      ? `&start_date=${from}&end_date=${to}${config.supportsCompare ? `&compare_to=${compareTo}` : ''}`
      : '';

    Promise.all(
      keys.map(async (key): Promise<RooftopRow> => {
        const dealer = dealers[key] || key;
        try {
          const res = await fetch(`${config.route}?accountKey=${encodeURIComponent(key)}${params}`);
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            const code = (body as { code?: string })?.code;
            const notConnected = code === 'not_configured' || code === 'no_ad_account';
            return {
              accountKey: key,
              dealer,
              metrics: null,
              status: notConnected ? 'not_configured' : 'error',
              message: (body as { error?: string })?.error,
            };
          }
          return { accountKey: key, dealer, metrics: config.extract(body), status: 'ok' };
        } catch (err) {
          return { accountKey: key, dealer, metrics: null, status: 'error', message: String(err) };
        }
      }),
    ).then((result) => {
      if (!cancelled) setRows(result);
    });

    return () => {
      cancelled = true;
    };
    // sig captures route + keys + window; the rest are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const connected = useMemo(() => (rows ?? []).filter((r) => r.status === 'ok'), [rows]);
  const notConnected = useMemo(() => (rows ?? []).filter((r) => r.status === 'not_configured'), [rows]);
  const errored = useMemo(() => (rows ?? []).filter((r) => r.status === 'error'), [rows]);

  if (rows === null) return <LoadingState />;

  if (connected.length === 0) {
    return (
      <EmptyState
        icon={LinkSlashIcon}
        title={`No sub-accounts connected to ${config.label}`}
        body={`None of this organization's ${rows.length} sub-accounts have ${config.label} connected for this window. Connect a sub-account's integration to see roll-up performance.`}
      />
    );
  }

  if (!hasAnyActivity(rows, config.metrics)) {
    return (
      <EmptyState
        icon={InboxStackIcon}
        title="No delivery in this window"
        body={`${config.label} is connected for ${connected.length} sub-account${connected.length === 1 ? '' : 's'}, but nothing ran in the selected range. Widen the date range to find active flights.`}
      />
    );
  }

  const kpiMetrics = config.metrics.slice(0, 6);

  const tableHead = ['Sub-Account', ...config.metrics.map((m) => m.label)];
  const tableRows: (string | number)[][] = [...rows]
    .sort((a, b) => {
      // Connected + active rooftops first, by the first sum metric desc.
      const first = config.metrics.find((m) => m.kind === 'sum');
      const av = first ? rooftopMetricValue(a.metrics, first) : 0;
      const bv = first ? rooftopMetricValue(b.metrics, first) : 0;
      return bv - av;
    })
    .map((r) => {
      if (r.status !== 'ok') {
        return [
          r.dealer,
          r.status === 'not_configured' ? 'Not connected' : 'Error',
          ...config.metrics.slice(1).map(() => '—'),
        ];
      }
      return [r.dealer, ...config.metrics.map((m) => m.format(rooftopMetricValue(r.metrics, m)))];
    });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <BuildingOffice2Icon className="h-4 w-4 text-[var(--primary)]" />
        <span className="font-medium text-[var(--foreground)]">Organization roll-up</span>
        <span>·</span>
        <span>
          {connected.length} of {rows.length} sub-account{rows.length === 1 ? '' : 's'} reporting {config.label}
        </span>
        {notConnected.length > 0 && <span>· {notConnected.length} not connected</span>}
        {errored.length > 0 && <span className="text-amber-500">· {errored.length} errored</span>}
      </div>

      {/* Org totals — additive metrics summed, rates recomputed from summed bases. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpiMetrics.map((m, i) => (
          <Kpi
            key={m.key}
            icon={m.icon ?? ChartBarIcon}
            label={m.label}
            value={m.format(aggregateMetric(rows, m))}
            tone={m.tone ?? TONES[i % TONES.length] ?? 'zinc'}
          />
        ))}
      </div>

      <Section title="By sub-account" icon={BuildingOffice2Icon} subtitle={`${connected.length} reporting`}>
        <DataTable head={tableHead} rows={tableRows} maxRows={12} />
        {notConnected.length > 0 && (
          <Muted>
            Not connected: {notConnected.map((r) => r.dealer).join(', ')}
          </Muted>
        )}
      </Section>
    </div>
  );
}
