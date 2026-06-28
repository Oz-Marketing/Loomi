'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import { GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { buildPacerCalc } from '@/lib/ad-pacer/pacer-calc';
import type { PacerAd } from '@/lib/ad-pacer/types';
import {
  mapChannelGroup,
  mapGoogleBudgetType,
  type ImportedGoogleCampaign,
  type ImportDiff,
} from '@/lib/ad-pacer/google-pacer-calc';

// ── Reference data ──
const CHANNELS = ['Search', 'Display', 'Video', 'Shopping', 'PMax'] as const;
const CHANNEL_COLOR: Record<string, string> = {
  Search: '#4285F4',
  Display: '#0F9D58',
  Video: '#DB4437',
  Shopping: '#F4B400',
  PMax: '#A142F4',
};
const STATUSES = ['Live', 'Scheduled', 'Completed Run', 'Off', 'In Draft'] as const;
const BUDGET_TYPES = ['Daily', 'Lifetime'] as const;

type PacerLogos = { light?: string; dark?: string; white?: string; black?: string } | null;

type GoogleAd = {
  id?: string;
  name: string;
  googleChannelType: string | null;
  adStatus: string;
  budgetType: string;
  budgetSource: string;
  allocation: string | null;
  pacerActual: string | null;
  pacerDailyBudget: string | null;
  flightStart: string | null;
  flightEnd: string | null;
  googleCampaignId?: string | null;
};

type PlanView = {
  ads: GoogleAd[];
  timeZone: string;
  frozen?: boolean;
  markup?: number;
  baseBudgetGoal?: string | null;
  addedBudgetGoal?: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (s: string | null | undefined) => (s == null || s === '' ? 0 : Number(s) || 0);

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

// Google campaign status → the tool's status vocabulary.
function mapGoogleStatus(status: string): string {
  switch ((status ?? '').toUpperCase()) {
    case 'ENABLED':
      return 'Live';
    case 'PAUSED':
      return 'Off';
    default:
      return 'In Draft';
  }
}

/**
 * Turn an imported Google campaign into a new planner line. We bring in the
 * structural fields (name, channel, budget type, daily budget, flight, status)
 * and the campaign link, but deliberately leave `allocation` empty — observed
 * platform budget is a suggestion, not the planner's intent (§8). The planner
 * sets the monthly allocation; Sync later fills actual spend.
 */
function campaignToAd(c: ImportedGoogleCampaign): GoogleAd {
  return {
    name: c.name,
    googleChannelType: mapChannelGroup(c.channelType),
    adStatus: mapGoogleStatus(c.status),
    budgetType: mapGoogleBudgetType(c.dailyBudget, c.totalBudget),
    budgetSource: 'base',
    allocation: null,
    pacerActual: null,
    pacerDailyBudget: c.dailyBudget != null ? String(c.dailyBudget) : null,
    flightStart: c.startDate,
    flightEnd: c.endDate,
    googleCampaignId: c.id,
  };
}

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData } = useAccount();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useState<'plan' | 'pace'>(mode === 'planner' ? 'plan' : 'pace');
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<GoogleAd | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportDiff | null>(null);

  const swrKey = accountKey
    ? `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`
    : null;
  const { data, isLoading, mutate } = useSWR<PlanView>(swrKey, fetcher, { revalidateOnFocus: false });
  const ads = useMemo(() => data?.ads ?? [], [data]);
  const tz = data?.timeZone ?? 'America/Denver';
  const frozen = !!data?.frozen;

  // Allocation rollup for the Plan view (campaign budgets summed, split by source).
  const totals = useMemo(() => {
    let total = 0,
      base = 0,
      added = 0;
    for (const a of ads) {
      const v = num(a.allocation);
      total += v;
      if (a.budgetSource === 'added') added += v;
      else base += v;
    }
    return { total, base, added };
  }, [ads]);

  // Per-platform account budget goals (Google's own — see schema). Client gross;
  // spend target = goal × markup.
  const markup = data?.markup ?? 0.77;
  const [baseGoal, setBaseGoal] = useState('');
  const [addedGoal, setAddedGoal] = useState('');
  useEffect(() => {
    setBaseGoal(data?.baseBudgetGoal ?? '');
    setAddedGoal(data?.addedBudgetGoal ?? '');
  }, [data?.baseBudgetGoal, data?.addedBudgetGoal]);

  async function persistBudget(nextBase: string, nextAdded: string) {
    if (!accountKey) return;
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
  }

  const { data: acct } = useSWR<{ googleAdsCustomerId?: string | null }>(
    accountKey ? `/api/accounts/${encodeURIComponent(accountKey)}` : null,
    fetcher,
  );
  const connected = !!(acct?.googleAdsCustomerId ?? '').toString().trim();

  // Persist the full Google set for this period — autosave full-replace, scoped
  // to platform=google on the server so Meta lines are never touched.
  async function persist(next: GoogleAd[]) {
    if (!accountKey) return;
    mutate({ ...(data as PlanView), ads: next }, { revalidate: false });
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

  function saveCampaign(c: GoogleAd) {
    persist(c.id ? ads.map((a) => (a.id === c.id ? c : a)) : [...ads, c]);
    setEditing(null);
  }
  async function deleteCampaign(c: GoogleAd) {
    const ok = await confirm({
      title: 'Delete campaign?',
      message: `Remove "${c.name || 'Untitled'}" from this month's plan.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) persist(ads.filter((a) => a.id !== c.id));
  }

  // §8 — pull all live campaigns and diff against the planned Google lines, then
  // open the review modal. Read-only until the user confirms in the modal.
  async function fetchImport() {
    if (!accountKey) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/import?period=${period}`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Import failed');
      const diff: ImportDiff | undefined = body?.diff;
      if (!diff || (diff.adds.length === 0 && diff.removes.length === 0 && diff.changes.length === 0)) {
        toast.success('Already in sync with Google — nothing to import');
        return;
      }
      setImportPreview(diff);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  // Apply the user's confirmed selections from the import review: add new lines,
  // drop removed ones, patch changed name/budget — then persist the merged set.
  function applyImport(sel: { adds: Set<string>; removes: Set<string>; changes: Set<number> }) {
    if (!importPreview) return;
    let next = [...ads];
    importPreview.changes.forEach((ch, i) => {
      if (!sel.changes.has(i)) return;
      next = next.map((a) => {
        if (a.id !== ch.adId) return a;
        if (ch.field === 'name') return { ...a, name: ch.to };
        if (ch.field === 'budgetType') return { ...a, budgetType: ch.to };
        return a;
      });
    });
    const removeIds = new Set(
      importPreview.removes.filter((r) => sel.removes.has(r.adId)).map((r) => r.adId),
    );
    if (removeIds.size) next = next.filter((a) => !a.id || !removeIds.has(a.id));
    const added = importPreview.adds.filter((c) => sel.adds.has(c.id)).map(campaignToAd);
    next = [...next, ...added];
    persist(next);
    setImportPreview(null);
    toast.success(
      `Imported ${added.length} new · ${removeIds.size} removed · ${sel.changes.size} updated`,
    );
  }

  async function syncFromGoogle() {
    if (!accountKey) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/sync-google?period=${period}`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Sync failed');
      toast.success(`Synced ${body?.sync?.matched ?? 0} campaign(s) from Google`);
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
    <div className="flex h-full flex-col pb-2">
      <Header
        mode={view}
        onMode={setView}
        dealer={accountData?.dealer ?? accountKey}
        accountKey={accountKey}
        logos={accountData?.logos ?? null}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] p-0.5">
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="Previous month"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium">{periodLabel(period)}</span>
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="Next month"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1" />

        {connected && (
          <button
            type="button"
            onClick={fetchImport}
            disabled={importing || frozen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <ArrowDownTrayIcon className={`h-4 w-4 ${importing ? 'animate-pulse' : ''}`} />
            Import campaigns
          </button>
        )}
        {connected && (
          <button
            type="button"
            onClick={syncFromGoogle}
            disabled={syncing || frozen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sync from Google
          </button>
        )}
        {!frozen && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            Add campaign
          </button>
        )}
      </div>

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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BudgetCard
          label="Base budget"
          goal={baseGoal}
          onGoal={setBaseGoal}
          onCommit={() => persistBudget(baseGoal, addedGoal)}
          markup={markup}
          allocated={totals.base}
          disabled={frozen}
        />
        <BudgetCard
          label="Added budget"
          goal={addedGoal}
          onGoal={setAddedGoal}
          onCommit={() => persistBudget(baseGoal, addedGoal)}
          markup={markup}
          allocated={totals.added}
          disabled={frozen}
        />
      </div>

      <div className="mt-4 -mx-6 overflow-x-auto px-6 md:-mx-8 md:px-8">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="px-3 py-2 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Budget</th>
              <th className="px-3 py-2 font-medium">{view === 'pace' ? 'Spend / Pacing' : 'Flight'}</th>
              <th className="px-3 py-2 font-medium">{view === 'pace' ? 'Rec. daily' : 'Daily'}</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {ads.map((ad, i) => (
              <CampaignRow
                key={ad.id ?? `new-${i}`}
                ad={ad}
                view={view}
                tz={tz}
                frozen={frozen}
                onEdit={() => !frozen && setEditing(ad)}
                onDelete={() => deleteCampaign(ad)}
              />
            ))}
            {!isLoading && ads.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-[var(--muted-foreground)]">
                  No Google campaigns for {periodLabel(period)} yet.
                  {!frozen && ' Add one, or sync from Google.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CampaignModal
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveCampaign}
        />
      )}

      {importPreview && (
        <ImportReviewModal
          diff={importPreview}
          onClose={() => setImportPreview(null)}
          onApply={applyImport}
        />
      )}
    </div>
  );
}

function Header({
  mode,
  onMode,
  dealer,
  accountKey,
  logos,
}: {
  mode: 'plan' | 'pace';
  onMode: (m: 'plan' | 'pace') => void;
  dealer: string | null;
  accountKey: string | null;
  logos: PacerLogos;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pt-2">
      <div className="flex items-center gap-3">
        {accountKey && dealer ? (
          <AccountAvatar
            name={dealer}
            accountKey={accountKey}
            logos={logos ?? undefined}
            size={40}
            className="flex-shrink-0 rounded-xl border border-[var(--border)]"
          />
        ) : (
          <GoogleAdsBrandIcon className="h-9 w-9" />
        )}
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">{dealer ?? 'Google Ads'}</h1>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {mode === 'plan'
              ? 'Plan & allocate Google campaign budgets'
              : 'Track Google spend pacing across the month'}
          </p>
        </div>
      </div>
      <div className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
        {(['plan', 'pace'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            aria-pressed={mode === m}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
              mode === m
                ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {m === 'plan' ? 'Plan' : 'Pace'}
          </button>
        ))}
      </div>
    </div>
  );
}

function CampaignRow({
  ad,
  view,
  tz,
  frozen,
  onEdit,
  onDelete,
}: {
  ad: GoogleAd;
  view: 'plan' | 'pace';
  tz: string;
  frozen: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const calc = useMemo(() => buildPacerCalc(ad as unknown as PacerAd, Date.now(), tz), [ad, tz]);
  const budget = num(ad.allocation);
  const spent = num(ad.pacerActual);
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const channelColor = ad.googleChannelType ? CHANNEL_COLOR[ad.googleChannelType] ?? '#888' : '#888';

  return (
    <tr className="border-b border-[var(--border)] last:border-0 transition hover:bg-[var(--muted)]/40">
      <td className="cursor-pointer px-3 py-2.5" onClick={onEdit}>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: channelColor }} />
          <span className="font-medium text-[var(--foreground)]">{ad.name || 'Untitled campaign'}</span>
          {ad.googleChannelType && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: channelColor }}
            >
              {ad.googleChannelType}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[var(--muted-foreground)]">{ad.adStatus}</td>
      <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
        {money(budget)}
        <span className="ml-1 text-[11px] opacity-70">
          {ad.budgetType === 'Lifetime' ? 'total' : '/mo plan'}
        </span>
      </td>
      {view === 'pace' ? (
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: pct >= 95 ? '#22c55e' : '#38bdf8' }}
              />
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              {money(spent)} / {money(budget)}
            </span>
          </div>
        </td>
      ) : (
        <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
          {ad.flightStart && ad.flightEnd ? `${ad.flightStart.slice(5)} → ${ad.flightEnd.slice(5)}` : '—'}
        </td>
      )}
      <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
        {view === 'pace'
          ? ad.budgetType === 'Lifetime'
            ? '—'
            : money(calc.recDaily)
          : money(num(ad.pacerDailyBudget))}
      </td>
      <td className="px-3 py-2.5 text-right">
        {!frozen && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete campaign"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-red-500/10 hover:text-red-500"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}

function CampaignModal({
  campaign,
  onClose,
  onSave,
}: {
  campaign: GoogleAd | null;
  onClose: () => void;
  onSave: (c: GoogleAd) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState(campaign?.googleChannelType ?? 'Search');
  const [status, setStatus] = useState(campaign?.adStatus ?? 'Live');
  const [budgetType, setBudgetType] = useState(campaign?.budgetType ?? 'Daily');
  const [budgetSource, setBudgetSource] = useState(campaign?.budgetSource ?? 'base');
  const [allocation, setAllocation] = useState(campaign?.allocation ?? '');
  const [dailyBudget, setDailyBudget] = useState(campaign?.pacerDailyBudget ?? '');
  const [flightStart, setFlightStart] = useState<string | null>(campaign?.flightStart ?? null);
  const [flightEnd, setFlightEnd] = useState<string | null>(campaign?.flightEnd ?? null);

  function submit() {
    if (!name.trim()) {
      toast.error('Campaign name is required');
      return;
    }
    onSave({
      ...campaign,
      name: name.trim(),
      googleChannelType: channel,
      adStatus: status,
      budgetType,
      budgetSource,
      allocation: allocation || null,
      pacerActual: campaign?.pacerActual ?? null,
      pacerDailyBudget: dailyBudget || null,
      flightStart,
      flightEnd,
    });
  }

  const fieldCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
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

function ImportReviewModal({
  diff,
  onClose,
  onApply,
}: {
  diff: ImportDiff;
  onClose: () => void;
  onApply: (sel: { adds: Set<string>; removes: Set<string>; changes: Set<number> }) => void;
}) {
  // Adds + changes default ON (safe, non-destructive); removes default OFF
  // (dropping a planned line is destructive — opt-in only).
  const [addsSel, setAddsSel] = useState<Set<string>>(() => new Set(diff.adds.map((c) => c.id)));
  const [changesSel, setChangesSel] = useState<Set<number>>(
    () => new Set(diff.changes.map((_, i) => i)),
  );
  const [removesSel, setRemovesSel] = useState<Set<string>>(() => new Set());

  const toggle = <T,>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const selectedCount = addsSel.size + changesSel.size + removesSel.size;
  const rowCls =
    'flex items-center gap-2.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Import from Google</h2>
        <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
          Review what changed on Google, then apply the selected items to this month&apos;s plan.
        </p>

        <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
          {/* New campaigns */}
          {diff.adds.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-500">
                <PlusCircleIcon className="h-4 w-4" /> New campaigns ({diff.adds.length})
              </div>
              <div className="space-y-1.5">
                {diff.adds.map((c) => {
                  const budgetType = mapGoogleBudgetType(c.dailyBudget, c.totalBudget);
                  const amount = budgetType === 'Lifetime' ? c.totalBudget : c.dailyBudget;
                  return (
                    <label key={c.id} className={`${rowCls} cursor-pointer`}>
                      <input
                        type="checkbox"
                        checked={addsSel.has(c.id)}
                        onChange={() => setAddsSel((s) => toggle(s, c.id))}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="flex-1 truncate font-medium text-[var(--foreground)]">
                        {c.name || 'Untitled campaign'}
                      </span>
                      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {mapChannelGroup(c.channelType)}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {amount != null ? money(amount) : '—'}{' '}
                        {budgetType === 'Lifetime' ? 'total' : '/day'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Changed campaigns */}
          {diff.changes.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-500">
                <PencilSquareIcon className="h-4 w-4" /> Changed ({diff.changes.length})
              </div>
              <div className="space-y-1.5">
                {diff.changes.map((ch, i) => (
                  <label key={`${ch.adId}-${ch.field}`} className={`${rowCls} cursor-pointer`}>
                    <input
                      type="checkbox"
                      checked={changesSel.has(i)}
                      onChange={() => setChangesSel((s) => toggle(s, i))}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    <span className="flex-1 text-[var(--foreground)]">
                      <span className="text-xs uppercase text-[var(--muted-foreground)]">{ch.field}:</span>{' '}
                      <span className="text-[var(--muted-foreground)] line-through">{ch.from || '—'}</span>{' '}
                      → <span className="font-medium">{ch.to || '—'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Removed campaigns */}
          {diff.removes.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-500">
                <MinusCircleIcon className="h-4 w-4" /> Gone on Google ({diff.removes.length})
              </div>
              <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                These planned lines no longer match a live Google campaign. Check to remove them.
              </p>
              <div className="space-y-1.5">
                {diff.removes.map((r) => (
                  <label key={r.adId} className={`${rowCls} cursor-pointer`}>
                    <input
                      type="checkbox"
                      checked={removesSel.has(r.adId)}
                      onChange={() => setRemovesSel((s) => toggle(s, r.adId))}
                      className="h-4 w-4 accent-red-500"
                    />
                    <span className="flex-1 truncate text-[var(--foreground)]">{r.name || 'Untitled'}</span>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={() => onApply({ adds: addsSel, removes: removesSel, changes: changesSel })}
            className="rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Apply {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function BudgetCard({
  label,
  goal,
  onGoal,
  onCommit,
  markup,
  allocated,
  disabled,
}: {
  label: string;
  goal: string;
  onGoal: (v: string) => void;
  onCommit: () => void;
  markup: number;
  allocated: number;
  disabled: boolean;
}) {
  const target = (Number(goal) || 0) * markup; // spend target = client gross × markup
  const remaining = target - allocated;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </p>
        <span className="text-[11px] text-[var(--muted-foreground)]">target {money(target)}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[var(--muted-foreground)]">$</span>
        <input
          value={goal}
          disabled={disabled}
          onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && onGoal(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="0"
          className="w-28 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold text-[var(--foreground)] outline-none hover:border-[var(--border)] focus:border-[var(--primary)] disabled:opacity-60"
        />
        <span className="text-xs text-[var(--muted-foreground)]">client / mo</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="text-[var(--muted-foreground)]">Allocated {money(allocated)}</span>
        <span className={remaining < 0 ? 'font-medium text-red-500' : 'text-[var(--muted-foreground)]'}>
          {remaining < 0 ? `${money(-remaining)} over` : `${money(remaining)} left`}
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}
