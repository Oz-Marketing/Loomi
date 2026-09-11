'use client';

/**
 * Everything a surface needs to offer "Generate from OEM offers" for one
 * account: what the run would build, whether it can run, how to start it, and
 * how to follow it.
 *
 * Lifted out of /ad-generator's page, where the report GET, the blocker
 * derivation, the candidate mapping and the POST lived inline. The Campaigns
 * wizard needs the same four things, and two copies of the readiness rule is
 * how the two doors come to disagree about whether an account is ready.
 *
 * Nothing is fetched until `enabled` — the report is heavy and admin-gated, so
 * the list page must not pay for it on load; the modal asks on open.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GenerateCandidate } from './offer-scope-picker';

export type OfferRunReadiness = 'loading' | 'no_access' | 'no_config' | 'no_offers' | 'ready';
export type OfferRunWarning = 'no_lead_design' | 'automation_off';

export interface OfferRunPreflight {
  readiness: OfferRunReadiness;
  warnings: OfferRunWarning[];
  candidates: GenerateCandidate[];
  maxVehiclesPerRun: number;
  runWindow: { start: string; end: string; mode: string } | null;
  emailEnabled: boolean;
  emailAudienceName: string | null;
  /** The designs a run may build, from the same columns the run reads. */
  permitted: { count: number; names: string[]; source: 'playbook' | 'settings' | 'all_published'; playbookName: string | null };
  leadDesignName: string | null;
  automationEnabled: boolean;
  /** When offers were last checked against the manufacturer feed. */
  lastPollAt: string | null;
  mode: string;
}

export interface OfferRunStatus {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  campaignId: string | null;
  generated: number;
  refreshed: number;
  skipped: number;
  email: { reason?: string | null; blastId?: string | null; updated?: boolean } | null;
}

export class OfferRunStartError extends Error {
  constructor(
    public readonly code: 'run_in_progress' | 'not_ready' | 'http',
    message: string,
    public readonly readiness?: OfferRunReadiness,
  ) {
    super(message);
  }
}

const EMPTY: OfferRunPreflight = {
  readiness: 'loading',
  warnings: [],
  candidates: [],
  maxVehiclesPerRun: 25,
  runWindow: null,
  emailEnabled: false,
  emailAudienceName: null,
  permitted: { count: 0, names: [], source: 'all_published', playbookName: null },
  leadDesignName: null,
  automationEnabled: false,
  lastPollAt: null,
  mode: 'draft',
};

/** The parts of the shadow report this hook reads. */
interface ReportLite {
  configured?: boolean;
  enabled?: boolean;
  scope?: {
    templateMap?: Record<string, string>;
    maxVehiclesPerRun?: number;
    mode?: string;
    emailEnabled?: boolean;
    emailAudienceId?: string | null;
    fanOutTemplateIds?: string[];
  };
  playbook?: { name: string } | null;
  audiences?: { id: string; name: string }[];
  templates?: { id: string; name: string }[];
  runWindow?: { start: string; end: string; mode: string };
  vehicles?: (GenerateCandidate & { liveOffers?: number })[];
  runs?: { kind: string; startedAt: string }[];
  totals?: { liveOffers?: number };
}

function toPreflight(d: ReportLite): OfferRunPreflight {
  const scope = d.scope ?? {};
  const lead = scope.templateMap?.all ?? null;
  const fan = scope.fanOutTemplateIds ?? [];
  const permittedIds = new Set([...fan, ...(lead ? [lead] : [])]);
  const templates = d.templates ?? [];
  const names = permittedIds.size
    ? templates.filter((t) => permittedIds.has(t.id)).map((t) => t.name)
    : templates.map((t) => t.name);
  const warnings: OfferRunWarning[] = [];
  if (!lead) warnings.push('no_lead_design');
  if (!d.enabled) warnings.push('automation_off');
  const polls = (d.runs ?? []).filter((r) => r.kind === 'offer_poll').map((r) => r.startedAt).sort();
  return {
    readiness: !d.configured ? 'no_config' : (d.totals?.liveOffers ?? 0) === 0 ? 'no_offers' : 'ready',
    warnings,
    // Only vehicles that could actually produce an ad — on the lot with at
    // least one live offer. The picker narrows further from there.
    candidates: (d.vehicles ?? [])
      .filter((v) => v.stock > 0 && (v.offerTypes?.length ?? 0) > 0)
      .map((v) => ({
        year: v.year,
        make: v.make,
        model: v.model,
        stock: v.stock,
        offerTypes: v.offerTypes ?? [],
        wouldChoose: v.wouldChoose ?? null,
        wouldChooseType: v.wouldChooseType ?? null,
        latestEnd: v.latestEnd ?? null,
      })),
    maxVehiclesPerRun: scope.maxVehiclesPerRun ?? 25,
    runWindow: d.runWindow ?? null,
    emailEnabled: !!scope.emailEnabled,
    emailAudienceName: (d.audiences ?? []).find((a) => a.id === scope.emailAudienceId)?.name ?? null,
    permitted: {
      count: names.length,
      names,
      source: permittedIds.size ? (d.playbook ? 'playbook' : 'settings') : 'all_published',
      playbookName: d.playbook?.name ?? null,
    },
    leadDesignName: lead ? templates.find((t) => t.id === lead)?.name ?? null : null,
    automationEnabled: !!d.enabled,
    lastPollAt: polls.length ? polls[polls.length - 1] : null,
    mode: scope.mode ?? 'draft',
  };
}

export function useOfferRun(accountKey: string | null, enabled: boolean) {
  const [preflight, setPreflight] = useState<OfferRunPreflight>(EMPTY);

  const reload = useCallback(async () => {
    if (!accountKey) return;
    setPreflight((p) => ({ ...p, readiness: 'loading' }));
    try {
      const res = await fetch(`/api/ad-generator/automation/shadow?accountKey=${encodeURIComponent(accountKey)}`);
      if (res.status === 403 || res.status === 404) {
        setPreflight({ ...EMPTY, readiness: 'no_access' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreflight(toPreflight((await res.json()) as ReportLite));
    } catch {
      setPreflight({ ...EMPTY, readiness: 'no_config' });
    }
  }, [accountKey]);

  useEffect(() => {
    if (enabled && accountKey) void reload();
    else setPreflight(EMPTY);
  }, [enabled, accountKey, reload]);

  /** Ask the manufacturer feed again now, then re-read. One lookup per watched vehicle. */
  const checkOffers = useCallback(async () => {
    if (!accountKey) return;
    await fetch('/api/ad-generator/automation/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountKey, action: 'poll_offers' }),
    });
    await reload();
  }, [accountKey, reload]);

  /** Start the run. Resolves to the run id once the server has opened its row. */
  const start = useCallback(
    async (scope: { vehicles: string[]; offerTypes: string[] }, notifyClients: boolean): Promise<string> => {
      if (!accountKey) throw new OfferRunStartError('http', 'No account selected');
      const res = await fetch('/api/ad-generator/automation/offer-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, scope, notifyClients }),
      });
      const json = (await res.json().catch(() => ({}))) as { runId?: string; error?: string; readiness?: OfferRunReadiness };
      if (res.status === 409) throw new OfferRunStartError('run_in_progress', 'A run is already in progress for this account.');
      if (res.status === 400 && json.error === 'not_ready') {
        throw new OfferRunStartError('not_ready', 'This account is not ready to run.', json.readiness);
      }
      if (!res.ok || !json.runId) throw new OfferRunStartError('http', json.error || `HTTP ${res.status}`);
      return json.runId;
    },
    [accountKey],
  );

  const pollRun = useCallback(async (runId: string): Promise<OfferRunStatus | null> => {
    const res = await fetch(`/api/ad-generator/automation/offer-run?runId=${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { run?: OfferRunStatus };
    return json.run ?? null;
  }, []);

  return { preflight, reload, checkOffers, start, pollRun };
}
