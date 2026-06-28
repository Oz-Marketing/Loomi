'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import { GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { UserPicker, type UserPickerUser } from '@/components/user-picker';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { buildPacerCalc } from '@/lib/ad-pacer/pacer-calc';
import type { PacerAd, PacerPlan } from '@/lib/ad-pacer/types';
import { makeAd, fmtDate } from '@/lib/ad-pacer/helpers';
import { COLORS as SHARED_COLORS } from '@/lib/ad-pacer/constants';
import {
  PacerReadOnlyContext,
  BudgetPanel,
  TotalAllocationHeader,
  AdSummaryRow,
  PacerRow,
  Tooltip,
} from '@/app/app/tools/_shared';

// ── Reference data ──
const CHANNELS = ['Search', 'Display', 'Video', 'Shopping', 'PMax'] as const;
const STATUSES = ['Live', 'Scheduled', 'Completed Run', 'Off', 'In Draft'] as const;
const BUDGET_TYPES = ['Daily', 'Lifetime'] as const;

type PacerLogos = { light?: string; dark?: string; white?: string; black?: string } | null;


const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Parse a response body without throwing on non-JSON (e.g. a gateway HTML error
// page). Returns a usable error object instead of "Unexpected token '<'".
async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server error (${res.status})` };
  }
}
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}


// Identical palette + pill chrome to Meta's AdStatusPill (full map).
const AD_STATUS_COLORS: Record<string, [string, string]> = {
  Live: ['#22c55e', '#ffffff'],
  'Ready- Pending Approval': ['#0ea5e9', '#ffffff'],
  'In Draft': ['#6b7280', '#ffffff'],
  Scheduled: ['#f59e0b', '#ffffff'],
  'Live - Changes Required': ['#a78bfa', '#ffffff'],
  'Pending Design': ['#ec4899', '#ffffff'],
  'Completed Run': ['#16a34a', '#ffffff'],
  Off: ['#14b8a6', '#ffffff'],
  'Waiting on Rep': ['#eab308', '#ffffff'],
  'Working on it': ['#f97316', '#ffffff'],
  Stuck: ['#ef4444', '#ffffff'],
  'Budget Adjustment': ['#06b6d4', '#ffffff'],
};

function AdStatusPill({ status }: { status: string }) {
  const [bg, color] = AD_STATUS_COLORS[status] ?? ['var(--muted)', 'var(--muted-foreground)'];
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: bg, color }}
    >
      {status || '—'}
    </span>
  );
}

// Budget type / source tag styling (mirrors Meta's row tags).

// Google-specific slots injected into the shared <PacerRow> (mirrors Meta's
// MetaSyncInfo / link picker). Read google* fields instead of meta* ones.
function GoogleSyncInfo({ ad, timeZone }: { ad: PacerAd; timeZone: string }) {
  if (!ad.googleCampaignId || (!ad.googleStartDate && !ad.googleEndDate)) return null;
  const effectiveEnd = buildPacerCalc(ad, Date.now(), timeZone).effectiveEnd;
  const parts: string[] = [
    `Google run: ${ad.googleStartDate ? fmtDate(ad.googleStartDate) : '—'} → ${
      ad.googleEndDate ? fmtDate(ad.googleEndDate) : 'ongoing'
    }`,
  ];
  if (effectiveEnd && (!ad.googleEndDate || ad.googleEndDate > effectiveEnd)) {
    parts.push(`Paced to ${fmtDate(effectiveEnd)} (month end)`);
  }
  return (
    <Tooltip label={parts.join(' · ')} placement="top">
      <span className="inline-flex flex-shrink-0 items-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        <InformationCircleIcon className="w-4 h-4" />
      </span>
    </Tooltip>
  );
}

// Read-only link status for the PacerRow's link slot. Google campaigns are
// linked at import time (no manual ad-set picker like Meta), so this just
// reflects the connection state.
function GoogleLinkBadge({ ad }: { ad: PacerAd }) {
  if (!ad.googleCampaignId) {
    return (
      <span className="text-[11px] text-[var(--muted-foreground)]">Not linked to Google</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
      <GoogleAdsBrandIcon className="h-3.5 w-3.5" />
      {ad.googleChannelType || 'Google'} · linked
    </span>
  );
}

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData } = useAccount();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useState<'plan' | 'pace'>(mode === 'planner' ? 'plan' : 'pace');
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<PacerAd | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Pace-view per-card expand state (mirrors Meta's BudgetPacerPanel).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const swrKey = accountKey
    ? `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`
    : null;
  const { data, isLoading, mutate } = useSWR<PacerPlan>(swrKey, fetcher, { revalidateOnFocus: false });
  const ads = useMemo<PacerAd[]>(() => data?.ads ?? [], [data]);
  const tz = data?.timeZone ?? 'America/Denver';
  const frozen = !!data?.frozen;

  // A full PacerPlan for the shared budget components (BudgetPanel +
  // TotalAllocationHeader read goals/markup/carryover and sum every ad via
  // adContribution). The server already returns this shape; normalize the
  // optional fields so the shared types are satisfied.
  const plan: PacerPlan | null = useMemo(
    () =>
      data
        ? {
            accountKey: accountKey ?? '',
            period,
            baseBudgetGoal: data.baseBudgetGoal ?? null,
            addedBudgetGoal: data.addedBudgetGoal ?? null,
            markup: data.markup ?? null,
            timeZone: tz,
            frozen,
            frozenAt: data.frozenAt ?? null,
            reopened: data.reopened ?? false,
            baseCarryover: data.baseCarryover ?? null,
            addedCarryover: data.addedCarryover ?? null,
            priorOverUnder: data.priorOverUnder ?? null,
            ads,
            siblingsByName: data.siblingsByName,
          }
        : null,
    [data, accountKey, period, tz, frozen, ads],
  );

  // Debounced budget-goal persist — BudgetPanel calls onChange per keystroke;
  // optimistically update the cached plan, then flush to the server after a pause.
  const budgetSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistBudget = (nextBase: string | null, nextAdded: string | null) => {
    if (!accountKey) return;
    if (budgetSaveTimer.current) clearTimeout(budgetSaveTimer.current);
    budgetSaveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            // Full ad set is required (PUT is full-replace, platform-scoped) plus
            // the Google budget goals.
            body: JSON.stringify({
              ads: ads.map((a) => ({ ...a, platform: 'google' })),
              baseBudgetGoal: nextBase || null,
              addedBudgetGoal: nextAdded || null,
            }),
          },
        );
        if (!res.ok) throw new Error();
        mutate();
      } catch {
        toast.error('Could not save budget');
        mutate();
      }
    }, 700);
  };

  // BudgetPanel hands back the whole plan with an edited goal; reflect it
  // optimistically + schedule the save.
  const onPlanChange = (next: PacerPlan) => {
    if (!data) return;
    mutate(
      { ...data, baseBudgetGoal: next.baseBudgetGoal, addedBudgetGoal: next.addedBudgetGoal },
      { revalidate: false },
    );
    persistBudget(next.baseBudgetGoal, next.addedBudgetGoal);
  };

  const { data: acct } = useSWR<{ googleAdsCustomerId?: string | null }>(
    accountKey ? `/api/accounts/${encodeURIComponent(accountKey)}` : null,
    fetcher,
  );
  const connected = !!(acct?.googleAdsCustomerId ?? '').toString().trim();

  // Directory for the import modal's Owner/Designer/Rep pickers.
  const { data: usersData } = useSWR<
    Array<{ id: string; name: string; title?: string | null; email: string; avatarUrl?: string | null }>
  >(accountKey ? '/api/users' : null, fetcher);
  const users: UserPickerUser[] = useMemo(
    () =>
      (usersData ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        title: u.title,
        email: u.email,
        avatarUrl: u.avatarUrl,
      })),
    [usersData],
  );

  // Persist the full Google set for this period — autosave full-replace, scoped
  // to platform=google on the server so Meta lines are never touched.
  async function persist(next: PacerAd[]) {
    if (!accountKey || !data) return;
    mutate({ ...data, ads: next }, { revalidate: false });
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ads: next.map((a) => ({ ...a, platform: 'google' })) }),
        },
      );
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      toast.error('Could not save');
      mutate();
    }
  }

  function saveCampaign(c: PacerAd) {
    persist(ads.some((a) => a.id === c.id) ? ads.map((a) => (a.id === c.id ? c : a)) : [...ads, c]);
    setEditing(null);
  }
  async function deleteCampaign(c: PacerAd) {
    const ok = await confirm({
      title: 'Delete campaign?',
      message: `Remove "${c.name || 'Untitled'}" from this month's plan.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) persist(ads.filter((a) => a.id !== c.id));
  }
  function cloneCampaign(id: string) {
    const src = ads.find((a) => a.id === id);
    if (!src) return;
    const copy = makeAd(ads.length, period);
    persist([...ads, { ...src, ...copy, name: `${src.name || 'Untitled'} (copy)` }]);
  }
  // One-ad mutation → optimistic full-replace persist (autosave).
  const updateAd = (next: PacerAd) =>
    persist(ads.map((a) => (a.id === next.id ? next : a)));
  // Cross-month accounting persists onto the row itself (fullRunAppliedToMonth /
  // lifetimeMonthSplit), so the standard full-replace PUT saves it.
  const resolveCrossMonth = (
    ad: PacerAd,
    action: 'apply_full_run' | 'split' | 'clear',
    splitMap?: Record<string, number>,
  ) => {
    if (action === 'apply_full_run')
      updateAd({ ...ad, fullRunAppliedToMonth: ad.period, lifetimeMonthSplit: null });
    else if (action === 'split')
      updateAd({
        ...ad,
        fullRunAppliedToMonth: null,
        lifetimeMonthSplit: JSON.stringify(splitMap ?? {}),
      });
    else updateAd({ ...ad, fullRunAppliedToMonth: null, lifetimeMonthSplit: null });
  };

  // The import modal returns the refreshed plan view (rows born linked + synced);
  // drop it straight into state, like the Meta importer's handleImported.
  function handleImported(data: PacerPlan & { import?: { imported: number; skipped: number } }) {
    mutate(data, { revalidate: false });
    const n = data.import?.imported ?? 0;
    const s = data.import?.skipped ?? 0;
    toast.success(
      `Imported ${n} campaign${n === 1 ? '' : 's'} from Google${s ? `. ${s} skipped.` : ''}`,
    );
    setImportOpen(false);
  }

  async function syncFromGoogle() {
    if (!accountKey) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/sync-google?period=${period}`,
        { method: 'POST' },
      );
      const body = await readJsonSafe(res);
      if (!res.ok) throw new Error((body?.error as string) || `Sync failed (${res.status})`);
      const matched = (body?.sync as { matched?: number } | undefined)?.matched ?? 0;
      toast.success(`Synced ${matched} campaign(s) from Google`);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (!accountKey) {
    return (
      <div className="pt-6">
        <Header mode={view} onMode={setView} dealer={null} accountKey={null} logos={null} />
        <div className="glass-section-card mt-4 rounded-xl p-6 text-sm text-[var(--muted-foreground)]">
          Select a sub-account from the switcher to {view === 'plan' ? 'plan' : 'pace'} its Google
          campaigns.
        </div>
      </div>
    );
  }

  return (
    <PacerReadOnlyContext.Provider value={frozen}>
    <div className="flex h-full flex-col pb-2">
      <Header
        mode={view}
        onMode={setView}
        dealer={accountData?.dealer ?? accountKey}
        accountKey={accountKey}
        logos={accountData?.logos ?? null}
        period={period}
        onShiftPeriod={(d) => setPeriod((p) => shiftPeriod(p, d))}
      />

      {!connected && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
          <span>
            Google Ads isn&apos;t connected — you can still plan &amp; pace manually. Connect to
            auto-import campaigns and sync spend.
          </span>
          <Link
            href="/settings/integrations"
            className="flex-shrink-0 font-medium text-[var(--primary)] hover:opacity-80"
          >
            Connect
          </Link>
        </div>
      )}

      {plan && (
        <div className="mt-5">
          <TotalAllocationHeader plan={plan} />
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <BudgetPanel
              title="Base Budget"
              source="base"
              color={SHARED_COLORS.base}
              goalKey="baseBudgetGoal"
              plan={plan}
              onChange={onPlanChange}
            />
            <BudgetPanel
              title="Added Budget"
              source="added"
              color={SHARED_COLORS.added}
              goalKey="addedBudgetGoal"
              plan={plan}
              onChange={onPlanChange}
            />
          </div>
        </div>
      )}

      {/* Action row above the table (mirrors Meta's Ad Plan header + CTAs). */}
      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-bold tracking-tight text-[var(--foreground)]">
          Campaigns · {periodLabel(period)}{' '}
          <span className="font-normal text-[var(--muted-foreground)]">({ads.length})</span>
        </span>
        <div className="flex items-center gap-2">
          {connected && (
            <button
              type="button"
              onClick={syncFromGoogle}
              disabled={syncing || frozen}
              title="Sync actual spend from Google"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Sync from Google"
            >
              <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
          {connected && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={frozen}
              title={
                frozen
                  ? 'This month is frozen — reopen it to import'
                  : 'Bring existing Google campaigns into this month as rows'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GoogleAdsBrandIcon className="h-3.5 w-3.5" />
              Import campaigns
            </button>
          )}
          {!frozen && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)]/90"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add campaign
            </button>
          )}
        </div>
      </div>

      {!isLoading && ads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No Google campaigns for {periodLabel(period)} yet.
          {!frozen && ' Add one, or sync from Google.'}
        </div>
      ) : view === 'pace' ? (
        // Pace view — stacked PacerRow cards (mirrors Meta's Spend Pacing).
        <div className="mt-1">
          {ads.map((ad, i) => (
            <PacerRow
              key={ad.id}
              ad={ad}
              index={i}
              timeZone={tz}
              expanded={expandedIds.has(ad.id)}
              onToggleExpanded={() => toggleExpanded(ad.id)}
              onActualChange={(v) => updateAd({ ...ad, pacerActual: v })}
              onDailyBudgetChange={(v) => updateAd({ ...ad, pacerDailyBudget: v })}
              onMuteToggle={() => updateAd({ ...ad, alertsMuted: !ad.alertsMuted })}
              onPushDailyBudget={async () => ({
                ok: false,
                text: 'Push to Google Ads isn’t available yet.',
              })}
              onResolveCrossMonth={(action, splitMap) =>
                resolveCrossMonth(ad, action, splitMap)
              }
              siblings={data?.siblingsByName?.[ad.name] ?? null}
              synced={!!ad.googleCampaignId && !!ad.pacerSyncedAt}
              linkPicker={<GoogleLinkBadge ad={ad} />}
              syncInfo={<GoogleSyncInfo ad={ad} timeZone={tz} />}
              pushLabel="Push to Google"
              pushIcon={<GoogleAdsBrandIcon className="h-3.5 w-3.5" />}
            />
          ))}
        </div>
      ) : (
        // Plan view — Meta-style table of AdSummaryRow.
        <div className="-mx-6 overflow-x-auto px-6 md:-mx-8 md:px-8">
          <table className="w-full min-w-[900px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-9 pl-3 pr-1 py-2" />
                {['Ad', '', 'Status', 'Due Date', 'Budget', 'Allocation', 'Flight Dates', 'Design', 'Approvals'].map((h, i) => (
                  <th
                    key={i}
                    className={`text-left px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] ${h === '' ? 'w-10 px-2' : ''}`}
                  >
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ads.map((ad, i) => (
                <AdSummaryRow
                  key={ad.id}
                  ad={ad}
                  index={i}
                  onClick={() => !frozen && setEditing(ad)}
                  onRemove={() => deleteCampaign(ad)}
                  onClone={() => cloneCampaign(ad.id)}
                  isSelected={false}
                  onSelectToggle={() => {}}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CampaignModal
          campaign={editing === 'new' ? null : editing}
          period={period}
          onClose={() => setEditing(null)}
          onSave={saveCampaign}
        />
      )}

      {importOpen && accountKey && (
        <ImportFromGoogleModal
          accountKey={accountKey}
          period={period}
          periodLabelText={periodLabel(period)}
          users={users}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
    </PacerReadOnlyContext.Provider>
  );
}

function Header({
  mode,
  onMode,
  dealer,
  accountKey,
  logos,
  period,
  onShiftPeriod,
}: {
  mode: 'plan' | 'pace';
  onMode: (m: 'plan' | 'pace') => void;
  dealer: string | null;
  accountKey: string | null;
  logos: PacerLogos;
  period?: string;
  onShiftPeriod?: (delta: number) => void;
}) {
  return (
    <div className="page-sticky-header mb-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* Left: title */}
        <div className="flex min-w-0 items-center gap-3">
          {accountKey && dealer ? (
            <AccountAvatar
              name={dealer}
              accountKey={accountKey}
              logos={logos ?? undefined}
              size={40}
              className="flex-shrink-0 rounded-xl border border-[var(--border)]"
            />
          ) : (
            <GoogleAdsBrandIcon className="h-8 w-8 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold text-[var(--foreground)]">
              {dealer ?? 'Google Ads'}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              {mode === 'plan'
                ? 'Plan & allocate Google campaign budgets'
                : 'Track Google spend pacing across the month'}
            </p>
          </div>
        </div>

        {/* Center: Plan / Pace switch */}
        <div className="flex justify-center">
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {(['plan', 'pace'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMode(m)}
                aria-pressed={mode === m}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {m === 'plan' ? 'Plan' : 'Pace'}
              </button>
            ))}
          </div>
        </div>

        {/* Right: month nav */}
        <div className="flex items-center justify-end gap-3">
          {period && onShiftPeriod && (
            <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
              <button
                type="button"
                onClick={() => onShiftPeriod(-1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">
                {periodLabel(period)}
              </span>
              <button
                type="button"
                onClick={() => onShiftPeriod(1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                aria-label="Next month"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function CampaignModal({
  campaign,
  period,
  onClose,
  onSave,
}: {
  campaign: PacerAd | null;
  period: string;
  onClose: () => void;
  onSave: (c: PacerAd) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState(campaign?.googleChannelType ?? 'Search');
  const [status, setStatus] = useState(campaign?.adStatus ?? 'Live');
  const [budgetType, setBudgetType] = useState<string>(campaign?.budgetType ?? 'Daily');
  const [budgetSource, setBudgetSource] = useState<string>(campaign?.budgetSource ?? 'base');
  const [allocation, setAllocation] = useState(campaign?.allocation ?? '');
  const [dailyBudget, setDailyBudget] = useState(campaign?.pacerDailyBudget ?? '');
  const [flightStart, setFlightStart] = useState<string | null>(campaign?.flightStart ?? null);
  const [flightEnd, setFlightEnd] = useState<string | null>(campaign?.flightEnd ?? null);

  function submit() {
    if (!name.trim()) {
      toast.error('Campaign name is required');
      return;
    }
    // Seed a full PacerAd for new rows so the shared components have every
    // field; existing rows keep their server-managed fields via the spread.
    const base = campaign ?? makeAd(0, period);
    onSave({
      ...base,
      platform: 'google',
      name: name.trim(),
      googleChannelType: channel,
      adStatus: status,
      budgetType: budgetType === 'Lifetime' ? 'Lifetime' : 'Daily',
      budgetSource: budgetSource === 'added' ? 'added' : budgetSource === 'split' ? 'split' : 'base',
      allocation: allocation || null,
      pacerDailyBudget: dailyBudget || null,
      flightStart,
      flightEnd,
    });
  }

  const fieldCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-modal w-full max-w-lg rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">
          {campaign ? 'Edit campaign' : 'Add Google campaign'}
        </h2>
        <div className="space-y-3">
          <Field label="Campaign name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldCls}
              placeholder="e.g. Summer Search — Brand"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel">
              <SearchableSelect
                value={channel ?? 'Search'}
                onChange={setChannel}
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Status">
              <SearchableSelect
                value={status}
                onChange={setStatus}
                options={STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget type">
              <SearchableSelect
                value={budgetType}
                onChange={setBudgetType}
                options={BUDGET_TYPES.map((b) => ({ value: b, label: b }))}
              />
            </Field>
            <Field label="Funding">
              <SearchableSelect
                value={budgetSource}
                onChange={setBudgetSource}
                options={[
                  { value: 'base', label: 'Base' },
                  { value: 'added', label: 'Added' },
                ]}
              />
            </Field>
          </div>
          <Field label={budgetType === 'Lifetime' ? 'Total budget ($)' : 'Monthly budget ($)'}>
            <input
              inputMode="decimal"
              value={allocation}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAllocation(e.target.value)}
              className={fieldCls}
              placeholder="0"
            />
          </Field>
          {budgetType !== 'Lifetime' && (
            <Field label="Planned daily ($)">
              <input
                inputMode="decimal"
                value={dailyBudget}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setDailyBudget(e.target.value)}
                className={fieldCls}
                placeholder="0"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Flight start">
              <DatePicker mode="single" value={flightStart} onChange={(v) => setFlightStart(v ?? null)} placeholder="Start" />
            </Field>
            <Field label="Flight end">
              <DatePicker mode="single" value={flightEnd} onChange={(v) => setFlightEnd(v ?? null)} placeholder="End" />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {campaign ? 'Save' : 'Add campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

type DiscoveredGoogleCampaign = {
  id: string;
  name: string;
  channelType: string;
  channelGroup: string;
  effectiveStatus: string;
  active: boolean;
  budgetType: 'Daily' | 'Lifetime';
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  periodSpend: number;
  alreadyLinked: boolean;
  suggestedStatus: string;
};

/**
 * Discovery + selection import — mirrors Meta's ImportFromMetaModal: list the
 * account's Google campaigns, search + show-paused/archived toggle, pick which to
 * adopt, bulk-assign Owner/Designer/Rep, import (born linked + synced).
 */
function ImportFromGoogleModal({
  accountKey,
  period,
  periodLabelText,
  users,
  onClose,
  onImported,
}: {
  accountKey: string;
  period: string;
  periodLabelText: string;
  users: UserPickerUser[];
  onClose: () => void;
  onImported: (data: PacerPlan & { import?: { imported: number; skipped: number } }) => void;
}) {
  const [campaigns, setCampaigns] = useState<DiscoveredGoogleCampaign[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [designerId, setDesignerId] = useState<string | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/discover?period=${period}`,
        );
        const body = await readJsonSafe(res);
        if (cancelled) return;
        if (!res.ok) {
          setError((body?.error as string) || `Failed to load campaigns (${res.status})`);
          setCampaigns([]);
        } else {
          setCampaigns((body?.campaigns as DiscoveredGoogleCampaign[]) ?? []);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load campaigns');
          setCampaigns([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (campaigns ?? []).filter((c) => {
      if (!showInactive && !c.active && !c.alreadyLinked) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.channelGroup.toLowerCase().includes(q);
    });
  }, [campaigns, search, showInactive]);

  const selectable = useMemo(() => visible.filter((c) => !c.alreadyLinked), [visible]);
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));
  const hiddenInactive = (campaigns ?? []).filter((c) => !c.active && !c.alreadyLinked).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.id)));

  async function doImport() {
    if (importing || selected.size === 0) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/import?period=${period}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            campaignIds: Array.from(selected),
            assignments: {
              ownerUserId: ownerId,
              designerUserId: designerId,
              accountRepUserId: repId,
            },
          }),
        },
      );
      const body = await readJsonSafe(res);
      if (!res.ok) throw new Error((body?.error as string) || `Import failed (${res.status})`);
      onImported(
        body as unknown as PacerPlan & { import?: { imported: number; skipped: number } },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const labelClass = 'block text-[11px] font-medium text-[var(--muted-foreground)] mb-1';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-16"
      onClick={() => !importing && onClose()}
    >
      <div
        className="glass-modal flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--foreground)]">
              <GoogleAdsBrandIcon className="h-4 w-4" />
              Import campaigns from Google
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Pick which of this account&apos;s campaigns to bring into {periodLabelText}. They&apos;re
              created already linked and synced.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !importing && onClose()}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar: search + show paused/archived */}
        <div className="mt-3 flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Show paused/archived
          </label>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Loading campaigns…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-500">{error}</div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {(campaigns ?? []).length === 0
                ? 'No campaigns found in this Google account.'
                : 'No matches.'}
              {hiddenInactive > 0 && !showInactive && (
                <div className="mt-1 text-xs">
                  {hiddenInactive} paused/archived hidden — toggle &ldquo;Show paused/archived&rdquo;.
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-[var(--primary)] hover:opacity-80"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">{selected.size} selected</span>
              </div>
              <div className="space-y-0.5">
                {visible.map((c) => {
                  const checked = selected.has(c.id);
                  const budgetLabel =
                    c.budgetType === 'Lifetime'
                      ? c.lifetimeBudget != null
                        ? `${money(c.lifetimeBudget)} lifetime`
                        : '— lifetime'
                      : c.dailyBudget != null
                        ? `${money(c.dailyBudget)}/day`
                        : 'No set budget';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={c.alreadyLinked}
                      onClick={() => toggle(c.id)}
                      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        c.alreadyLinked
                          ? 'cursor-not-allowed opacity-50'
                          : checked
                            ? 'bg-[var(--primary)]/10'
                            : 'hover:bg-[var(--muted)]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                          checked && !c.alreadyLinked
                            ? 'border-[var(--primary)] bg-[var(--primary)]'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        {checked && !c.alreadyLinked && <CheckIcon className="h-3 w-3 text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--foreground)]">
                            {c.name}
                          </span>
                          {c.alreadyLinked ? (
                            <span className="whitespace-nowrap rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                              Imported
                            </span>
                          ) : (
                            <AdStatusPill status={c.suggestedStatus} />
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                          {c.channelGroup} · {budgetLabel}
                          {c.periodSpend > 0 && ` · ${money(c.periodSpend)} spent`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer: bulk assignment + actions */}
        <div className="border-t border-[var(--border)] p-5 pt-4">
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Owner</label>
              <UserPicker value={ownerId} onChange={setOwnerId} users={users} placeholder="— Unassigned —" />
            </div>
            <div>
              <label className={labelClass}>Designer</label>
              <UserPicker value={designerId} onChange={setDesignerId} users={users} placeholder="— Unassigned —" />
            </div>
            <div>
              <label className={labelClass}>Account Rep</label>
              <UserPicker value={repId} onChange={setRepId} users={users} placeholder="— Unassigned —" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => !importing && onClose()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doImport}
              disabled={importing || selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
              {importing
                ? 'Importing…'
                : `Import ${selected.size || ''} campaign${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Account-level allocation summary above the budget cards (mirrors Meta's
 *  TotalAllocationHeader): total spend budget, total allocated, % + a combined
 *  Base/Added bar with legend. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}
