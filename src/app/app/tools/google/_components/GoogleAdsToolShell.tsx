'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
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

type PlanView = { ads: GoogleAd[]; timeZone: string; frozen?: boolean };

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

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData } = useAccount();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useState<'plan' | 'pace'>(mode === 'planner' ? 'plan' : 'pace');
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<GoogleAd | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);

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
            href={`/subaccounts/${encodeURIComponent(accountKey)}`}
            className="flex-shrink-0 font-medium text-[var(--primary)] hover:opacity-80"
          >
            Connect
          </Link>
        </div>
      )}

      {ads.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Total allocated', value: totals.total },
            { label: 'Base', value: totals.base },
            { label: 'Added', value: totals.added },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                {s.label}
              </p>
              <p className="mt-0.5 text-lg font-semibold text-[var(--foreground)]">{money(s.value)}</p>
            </div>
          ))}
        </div>
      )}

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
            {ads.map((ad) => (
              <CampaignRow
                key={ad.id}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}
