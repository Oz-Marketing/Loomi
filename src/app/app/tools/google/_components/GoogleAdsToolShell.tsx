'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
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
import type { PacerAd } from '@/lib/ad-pacer/types';

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

// ── Meta-matched visual language (mirrors MetaAdsPlannerTool) ──
const COLORS = {
  daily: '#38bdf8',
  lifetime: '#a78bfa',
  base: '#38bdf8',
  added: '#34d399',
  success: '#22c55e',
  warn: '#f59e0b',
  error: '#ef4444',
};

// Same palette + pill chrome as Meta's AdStatusPill.
const AD_STATUS_COLORS: Record<string, [string, string]> = {
  Live: ['#22c55e', '#ffffff'],
  Scheduled: ['#f59e0b', '#ffffff'],
  'Completed Run': ['#16a34a', '#ffffff'],
  Off: ['#14b8a6', '#ffffff'],
  'In Draft': ['#6b7280', '#ffffff'],
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
const budgetTypeTint = (t: string) =>
  t === 'Lifetime' ? 'rgba(167,139,250,0.18)' : 'rgba(56,189,248,0.18)';
const budgetTypeColor = (t: string) => (t === 'Lifetime' ? COLORS.lifetime : COLORS.daily);
const sourceTint = (s: string) =>
  s === 'added' ? 'rgba(52,211,153,0.18)' : 'rgba(56,189,248,0.18)';
const sourceColor = (s: string) => (s === 'added' ? COLORS.added : COLORS.base);

// Flight progress bar — status-colored (mirrors Meta's FlightBar).
function runDateColor(status: string): string {
  if (status === 'Completed Run') return COLORS.success;
  if (status === 'Off' || status === 'In Draft') return '#9ca3af';
  return status === 'Live' || status === 'Scheduled' ? COLORS.daily : COLORS.error;
}
function flightElapsedPct(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!(e > s)) return 0;
  return Math.max(0, Math.min(100, ((Date.now() - s) / (e - s)) * 100));
}
function FlightBar({
  start,
  end,
  status,
}: {
  start: string | null;
  end: string | null;
  status: string;
}) {
  if (!start || !end) return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
  const pct = flightElapsedPct(start, end);
  return (
    <div className="relative h-[22px] min-w-[132px] w-full overflow-hidden rounded-full bg-[var(--muted)]">
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{ width: `${pct}%`, background: runDateColor(status) }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap px-2 text-[11px] font-semibold text-white"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {start.slice(5)} – {end.slice(5)}
      </span>
    </div>
  );
}

// Spend pacing bar — same chrome as FlightBar (mirrors Meta's pacing bars).
function PacingBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  return (
    <div className="relative h-[22px] min-w-[132px] w-full overflow-hidden rounded-full bg-[var(--muted)]">
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{ width: `${pct}%`, background: pct >= 95 ? COLORS.success : COLORS.daily }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap px-2 text-[11px] font-semibold text-white"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {money(spent)} / {money(budget)}
      </span>
    </div>
  );
}

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData } = useAccount();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useState<'plan' | 'pace'>(mode === 'planner' ? 'plan' : 'pace');
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<GoogleAd | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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

  // The import modal returns the refreshed plan view (rows born linked + synced);
  // drop it straight into state, like the Meta importer's handleImported.
  function handleImported(data: PlanView & { import?: { imported: number; skipped: number } }) {
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
            onClick={() => setImportOpen(true)}
            disabled={frozen}
            title={
              frozen
                ? 'This month is frozen — reopen it to import'
                : 'Bring existing Google campaigns into this month as rows'
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleAdsBrandIcon className="h-4 w-4" />
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

      <div className="mt-5">
        <TotalAllocationHeader
          baseGoal={baseGoal}
          addedGoal={addedGoal}
          base={totals.base}
          added={totals.added}
          markup={markup}
        />
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <BudgetCard
            label="Base Budget"
            color={COLORS.base}
            goal={baseGoal}
            onGoal={setBaseGoal}
            onCommit={() => persistBudget(baseGoal, addedGoal)}
            markup={markup}
            allocated={totals.base}
            disabled={frozen}
          />
          <BudgetCard
            label="Added Budget"
            color={COLORS.added}
            goal={addedGoal}
            onGoal={setAddedGoal}
            onCommit={() => persistBudget(baseGoal, addedGoal)}
            markup={markup}
            allocated={totals.added}
            disabled={frozen}
          />
        </div>
      </div>

      <div className="mt-6 -mx-6 overflow-x-auto px-6 md:-mx-8 md:px-8">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
              {['Campaign', 'Status', 'Budget', 'Allocation', view === 'pace' ? 'Spend / Pacing' : 'Flight Dates', view === 'pace' ? 'Rec. daily' : 'Daily'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
                  >
                    {h}
                  </th>
                ),
              )}
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
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-[var(--muted-foreground)]">
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
  const channelColor = ad.googleChannelType ? CHANNEL_COLOR[ad.googleChannelType] ?? '#888' : '#888';

  return (
    <tr className="group border-b border-[var(--border)] last:border-b-0 cursor-pointer transition-colors hover:bg-[var(--muted)]/50">
      {/* Campaign — color dot + name + channel tag */}
      <td className="min-w-[200px] px-3 py-2 align-middle" onClick={onEdit}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: channelColor }} />
          <span className="truncate text-sm font-semibold text-[var(--foreground)]">
            {ad.name || 'Untitled campaign'}
          </span>
          {ad.googleChannelType && (
            <span
              className="whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
              style={{ background: channelColor }}
            >
              {ad.googleChannelType}
            </span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="whitespace-nowrap px-3 py-2 align-middle" onClick={onEdit}>
        <AdStatusPill status={ad.adStatus} />
      </td>

      {/* Budget — type + source tags */}
      <td className="whitespace-nowrap px-3 py-2 align-middle" onClick={onEdit}>
        <div className="flex items-center gap-1">
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: budgetTypeTint(ad.budgetType), color: budgetTypeColor(ad.budgetType) }}
          >
            {ad.budgetType}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: sourceTint(ad.budgetSource), color: sourceColor(ad.budgetSource) }}
          >
            {ad.budgetSource === 'added' ? 'Added' : 'Base'}
          </span>
        </div>
      </td>

      {/* Allocation */}
      <td
        className="whitespace-nowrap px-3 py-2 align-middle text-xs font-semibold"
        style={{ color: sourceColor(ad.budgetSource) }}
        onClick={onEdit}
      >
        {money(budget)}
        <span className="ml-1 font-normal opacity-60">{ad.budgetType === 'Lifetime' ? 'total' : '/mo'}</span>
      </td>

      {/* Flight bar (plan) / spend pacing bar (pace) */}
      <td className="px-3 py-2 align-middle" onClick={onEdit}>
        {view === 'pace' ? (
          <PacingBar spent={spent} budget={budget} />
        ) : (
          <FlightBar start={ad.flightStart} end={ad.flightEnd} status={ad.adStatus} />
        )}
      </td>

      {/* Daily (plan) / recommended daily (pace) */}
      <td className="whitespace-nowrap px-3 py-2 align-middle text-xs text-[var(--muted-foreground)]" onClick={onEdit}>
        {view === 'pace'
          ? ad.budgetType === 'Lifetime'
            ? '—'
            : money(calc.recDaily)
          : money(num(ad.pacerDailyBudget))}
      </td>

      {/* Hover delete */}
      <td className="px-3 py-2 align-middle text-right">
        {!frozen && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete campaign"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
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
  onImported: (data: PlanView & { import?: { imported: number; skipped: number } }) => void;
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
      onImported(body as PlanView & { import?: { imported: number; skipped: number } });
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
function TotalAllocationHeader({
  baseGoal,
  addedGoal,
  base,
  added,
  markup,
}: {
  baseGoal: string;
  addedGoal: string;
  base: number;
  added: number;
  markup: number;
}) {
  const target = ((Number(baseGoal) || 0) + (Number(addedGoal) || 0)) * markup;
  const allocated = base + added;
  const pct = target > 0 ? (allocated / target) * 100 : null;
  const pctColor =
    pct == null ? 'var(--muted-foreground)' : pct > 105 ? COLORS.error : pct >= 95 ? COLORS.success : COLORS.warn;
  const baseW = target > 0 ? Math.min((base / target) * 100, 100) : 0;
  const addedW = target > 0 ? Math.min((added / target) * 100, 100 - baseW) : 0;

  return (
    <div className="px-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
          Total Account Allocation
        </span>
        <div className="flex flex-wrap gap-4">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Spend budget
            </div>
            <div className="text-base font-bold tabular-nums text-[var(--foreground)]">{money(target)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Allocated
            </div>
            <div className="text-base font-bold tabular-nums text-[var(--foreground)]">{money(allocated)}</div>
          </div>
          {pct != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">%</div>
              <div className="text-base font-bold tabular-nums" style={{ color: pctColor }}>
                {pct.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--muted)]">
        {baseW > 0 && (
          <div className="h-full transition-[width] duration-500" style={{ width: `${baseW}%`, background: COLORS.base }} />
        )}
        {addedW > 0 && (
          <div className="h-full transition-[width] duration-500" style={{ width: `${addedW}%`, background: COLORS.added }} />
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
          <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.base }} />
          Base <span className="font-bold" style={{ color: COLORS.base }}>{money(base)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
          <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.added }} />
          Added <span className="font-bold" style={{ color: COLORS.added }}>{money(added)}</span>
        </div>
      </div>
    </div>
  );
}

function BudgetCard({
  label,
  color,
  goal,
  onGoal,
  onCommit,
  markup,
  allocated,
  disabled,
}: {
  label: string;
  color: string;
  goal: string;
  onGoal: (v: string) => void;
  onCommit: () => void;
  markup: number;
  allocated: number;
  disabled: boolean;
}) {
  const target = (Number(goal) || 0) * markup; // spend target = client gross × markup
  const remaining = target - allocated;
  const pct = target > 0 ? (allocated / target) * 100 : null;
  const status = pct == null ? null : pct > 105 ? 'over' : pct >= 95 ? 'perfect' : 'under';
  const statusColor = status === 'over' ? COLORS.error : status === 'perfect' ? COLORS.success : COLORS.warn;

  return (
    <div className="glass-section-card min-w-[280px] flex-1 rounded-xl px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color }}>
            {label}
          </span>
          {status && (
            <span
              className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background:
                  status === 'over'
                    ? 'rgba(239,68,68,0.18)'
                    : status === 'perfect'
                      ? 'rgba(34,197,94,0.18)'
                      : 'rgba(245,158,11,0.18)',
                color: statusColor,
              }}
            >
              {status === 'over' ? 'Over' : status === 'perfect' ? 'Full' : 'Under'}
            </span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          target {money(target)}
        </span>
      </div>

      <div className="mb-3">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Client Budget Goal (Gross)
        </span>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
            $
          </span>
          <input
            value={goal}
            disabled={disabled}
            onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && onGoal(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="0.00"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-2 pl-6 pr-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-x-7 gap-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Allocated</div>
          <div className="text-2xl font-bold leading-none tabular-nums" style={{ color: statusColor }}>
            {money(allocated)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {remaining < 0 ? 'Over' : 'Remaining'}
          </div>
          <div
            className="text-2xl font-bold leading-none tabular-nums"
            style={{ color: remaining < 0 ? COLORS.error : COLORS.success }}
          >
            {money(Math.abs(remaining))}
          </div>
        </div>
      </div>

      {target > 0 && (
        <>
          <div className="mb-1 flex justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Allocation
            </span>
            <span className="text-[10px] font-bold" style={{ color: statusColor }}>
              {pct != null ? `${pct.toFixed(1)}%` : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: `${Math.min(pct ?? 0, 100)}%`, background: color }}
            />
          </div>
        </>
      )}
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
