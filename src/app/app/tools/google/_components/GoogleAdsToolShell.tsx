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
  ClipboardDocumentListIcon,
  AdjustmentsHorizontalIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { InvestmentIcon } from '@/components/icons/investment';
import {
  ReconciliationPanel,
  OverviewView,
  type OverviewAccount,
} from '@/app/app/tools/meta/_components/ReconciliationViews';
import {
  EMPTY_FILTERS,
  applyFilters,
  activeFilterCount,
  type PlanFilters,
} from '@/lib/ad-pacer/filters';
import { MetaAdsPacerFilterSidebar } from '@/app/app/tools/meta/_components/FilterSidebar';
import { useSession } from 'next-auth/react';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import { GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { UserPicker, type UserPickerUser } from '@/components/user-picker';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import type { PacerAd, PacerPlan, DirectoryUser, PeriodSummary } from '@/lib/ad-pacer/types';
import { CopyPlanModal, type CopyFieldOptions } from '@/app/app/tools/meta/_components/CopyPlanModal';
import { makeAd } from '@/lib/ad-pacer/helpers';
import { COLORS as SHARED_COLORS } from '@/lib/ad-pacer/constants';
import {
  PacerReadOnlyContext,
  BudgetPanel,
  TotalAllocationHeader,
  AddPlanButton,
  AccountNotesButton,
  AdSummaryRow,
  AdEditorModal,
  Tooltip,
  BulkAddAdsModal,
  Field,
  ComparePanel,
  StatusBattery,
} from '@/app/app/tools/_shared';
import { AccountNotesDrawer } from '@/app/app/tools/meta/_components/AccountNotesDrawer';
import { GooglePacingCard, type AccountPaceSummary } from './GooglePacingCard';
import { ACCOUNT_PACE_LABELS, PACE_COLORS } from './google-pacing-theme';

// ── Reference data ──
const CHANNELS = ['Search', 'Display', 'Video', 'Shopping', 'PMax', 'Demand Gen'] as const;


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

export function GoogleAdsToolShell({ mode }: { mode: 'planner' | 'pacer' }) {
  const { accountKey, accountData, setAccount } = useAccount();
  const { confirm } = useLoomiDialog();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;
  // One flat tab bar mirroring Meta: Planner · Pacing · Reconciliation.
  // `reconView` toggles the Reconciliation tab between the year settlement and
  // the per-ad Over/Under view.
  const [tab, setTab] = useState<'planner' | 'pacing' | 'reconcile'>(
    mode === 'planner' ? 'planner' : 'pacing',
  );
  const [reconView, setReconView] = useState<'recon' | 'compare'>('recon');
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<PacerAd | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  /** The pace verdict the Pacing card computes, rendered up in the scope row.
   *  Null whenever that card is not mounted, which is what keeps a verdict from
   *  outliving the tab that produced it. */
  const [pace, setPace] = useState<AccountPaceSummary | null>(null);
  // Basic (default) vs Detailed plan view — Detailed adds the Design +
  // Approvals columns and the matching editor sections. Same sticky
  // preference as Meta's planner, so the choice follows the user.
  // Which account's notes drawer is open (null = closed). Carries an accountKey
  // so an admin can open notes for any card, not just the selected account.
  const [notesTarget, setNotesTarget] = useState<{ accountKey: string; label: string } | null>(
    null,
  );
  const [notesCount, setNotesCount] = useState<number | null>(null);

  const swrKey = accountKey
    ? `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`
    : null;
  const { data, isLoading, mutate } = useSWR<PacerPlan>(swrKey, fetcher, { revalidateOnFocus: false });
  const ads = useMemo<PacerAd[]>(() => data?.ads ?? [], [data]);
  // Rendered rows = the sidebar filters (mirrors Meta's applyFilters). The
  // free-text search box was removed; the Filters sidebar is the one place that
  // narrows the list, so there is no second, competing filter to reason about.
  const visibleAds = useMemo(
    () => applyFilters(ads, filters, currentUserId),
    [ads, filters, currentUserId],
  );
  // Period list (Google-scoped) for the "copy from another month" modal.
  const { data: periodsData } = useSWR<{ periods: PeriodSummary[] }>(
    accountKey
      ? `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}/periods?platform=google`
      : null,
    fetcher,
  );
  const periods = useMemo<PeriodSummary[]>(() => periodsData?.periods ?? [], [periodsData]);
  const otherPeriodsWithAds = periods.some((p) => p.period !== period && p.adCount > 0);

  // Admin all-accounts overview — only fetched when no sub-account is selected.
  const { data: overviewData, error: overviewError } = useSWR<{ accounts: OverviewAccount[] }>(
    !accountKey
      ? `/api/meta-ads-pacer/overview?period=${period}&platform=google`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );
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
            budgetManaged: data.budgetManaged ?? false,
            markup: data.markup ?? null,
            timeZone: tz,
            frozen,
            frozenAt: data.frozenAt ?? null,
            reopened: data.reopened ?? false,
            baseCarryover: data.baseCarryover ?? null,
            addedCarryover: data.addedCarryover ?? null,
            priorOverUnder: data.priorOverUnder ?? null,
            // Google allocator settings (spec §3/§9) — the card's unit and the
            // per-label intended budgets.
            allocationMode: data.allocationMode ?? 'pct',
            eventBudgets: data.eventBudgets ?? {},
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
    Array<{
      id: string;
      name: string;
      title?: string | null;
      email: string;
      avatarUrl?: string | null;
      role?: string | null;
      department?: string | null;
    }>
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
  // Full directory shape for the shared editor's role pickers.
  const directoryUsers: DirectoryUser[] = useMemo(
    () =>
      (usersData ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        title: u.title ?? null,
        email: u.email,
        avatarUrl: u.avatarUrl ?? null,
        role: u.role ?? '',
        department: u.department ?? null,
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
  // Activity log — the per-ad endpoints are keyed by accountKey + adId on the
  // shared MetaAdsPacerAd table, so Google rows reuse them. Refetch after each
  // change so the editor's live log updates.
  const onAddActivity = async (adId: string, text: string, file: File | null) => {
    if (!accountKey) return;
    const url = `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}/ads/${adId}/activity`;
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', file);
      res = await fetch(url, { method: 'POST', body: fd });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
    mutate();
  };
  const onEditActivity = async (adId: string, entryId: string, text: string) => {
    if (!accountKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}/ads/${adId}/activity/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
    mutate();
  };
  const onDeleteActivity = async (adId: string, entryId: string) => {
    if (!accountKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}/ads/${adId}/activity/${entryId}`,
      { method: 'DELETE' },
    );
    if (res.ok) mutate();
  };

  // The pacing card's single write path: ad rows and/or its period-scoped
  // settings, in ONE full-replace PUT. Deliberately not split into two calls —
  // a mode switch changes both at once, and two PUTs in the same tick race, with
  // the one carrying the pre-switch rows overwriting the other (that wiped every
  // allocation on the account). Callers that change only settings omit `ads` and
  // this sends the current set unchanged.
  const persistCard = async (payload: {
    ads?: PacerAd[];
    allocationMode?: 'pct' | 'amt';
    eventBudgets?: Record<string, number>;
  }) => {
    if (!accountKey || !data) return;
    const nextAds = payload.ads ?? ads;
    const settings = {
      ...(payload.allocationMode !== undefined ? { allocationMode: payload.allocationMode } : {}),
      ...(payload.eventBudgets !== undefined ? { eventBudgets: payload.eventBudgets } : {}),
    };
    // Reflect optimistically so the table doesn't flicker back through the old
    // numbers while the save is in flight.
    mutate({ ...data, ads: nextAds, ...settings }, { revalidate: false });
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}?period=${period}&platform=google`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ads: nextAds.map((a) => ({ ...a, platform: 'google' })),
            ...settings,
          }),
        },
      );
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      toast.error('Could not save');
      mutate();
    }
  };

  // §8 apply the card's recommended dailies — ONE batched mutate for the account.
  // The server recomputes the plan from stored allocations, so a stale tab can't
  // push last hour's numbers.
  const [pushingBudgets, setPushingBudgets] = useState(false);
  const pushAllBudgets = async (adIds?: readonly string[]) => {
    if (!accountKey || pushingBudgets) return;
    setPushingBudgets(true);
    try {
      const res = await fetch(
        `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/push-budgets?period=${period}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Empty/absent = the whole drifted batch; a list = exactly these
          // campaigns, drift gate off (§14).
          body: JSON.stringify(adIds && adIds.length > 0 ? { adIds: [...adIds] } : {}),
        },
      );
      const body = await readJsonSafe(res);
      if (!res.ok) throw new Error((body?.error as string) || `Push failed (${res.status})`);
      const pushedCount = (body?.pushedCount as number) ?? 0;
      const single = adIds != null && adIds.length === 1;
      const skipped = (body?.skipped as unknown[] | undefined)?.length ?? 0;
      // Name the held-back campaigns rather than reporting a bare count — "3
      // skipped" with no reason is the kind of message people learn to ignore.
      const heldBack = (
        (body?.skipped as { name: string; reason: string }[] | undefined) ?? []
      ).filter((s) => s.reason !== 'below_threshold');
      if (pushedCount === 0) {
        // A deliberate single apply that pushed nothing means it was structurally
        // blocked, not merely within range — say which, rather than the batch's
        // "already within range", which would be a lie for a below-threshold pick
        // the server was told to honour.
        const why = (body?.skipped as { name: string; reason: string }[] | undefined)?.[0];
        toast.success(
          single && why
            ? `${why.name} could not be pushed (${why.reason.replace(/_/g, ' ')})`
            : skipped > 0
              ? 'Every campaign is already within range — nothing to push'
              : 'Nothing to push',
        );
      } else if (single) {
        const one = (body?.pushed as { name: string; from: number; to: number }[] | undefined)?.[0];
        toast.success(
          one
            ? `${one.name}: daily budget set to $${one.to.toFixed(2)} in Google`
            : 'Daily budget set in Google',
        );
      } else {
        toast.success(
          `Set ${pushedCount} daily budget${pushedCount === 1 ? '' : 's'} in Google` +
            (heldBack.length > 0
              ? ` · skipped ${heldBack.map((s) => s.name).join(', ')}`
              : ''),
        );
      }
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPushingBudgets(false);
    }
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

  // Copy a prior month's Google plan into this period (platform-scoped server-
  // side so it never pulls in Meta lines). Mirrors Meta's handleCopyFrom.
  async function handleCopyFrom(from: string, adIds: string[], fields: CopyFieldOptions) {
    if (!accountKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${encodeURIComponent(accountKey)}/copy-from?platform=google`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: period, adIds, fields }),
      },
    );
    const body = await readJsonSafe(res);
    if (!res.ok) throw new Error((body?.error as string) || `Copy failed (${res.status})`);
    mutate(body as unknown as PacerPlan, { revalidate: false });
    setShowCopyModal(false);
    toast.success('Plan copied from another month');
  }

  if (!accountKey) {
    // Admin mode — mirror Meta: an all-accounts overview (every account the user
    // can access, regardless of whether it has Google data yet) with a comment
    // icon + Open per card, rather than forcing an account selection.
    return (
      <div className="pt-6">
        <Header
          tab={tab}
          onTab={setTab}
          accountKey={null}
          period={period}
          onShiftPeriod={(d) => setPeriod((p) => shiftPeriod(p, d))}
          filtersActive={activeFilterCount(filters)}
          filtersOpen={filterSidebarOpen}
          onToggleFilters={() => setFilterSidebarOpen((o) => !o)}
        />
        {/* Reuse Meta's expandable overview for exact parity — each account row
            expands to its ad drill-down; notes + Open are wired per row. Every
            accessible account shows regardless of whether it has Google data. */}
        <OverviewView
          period={period}
          filters={filters}
          currentUserId={currentUserId}
          onOpenAccount={(key) => setAccount({ mode: 'account', accountKey: key })}
          users={directoryUsers}
          accounts={overviewData?.accounts ?? null}
          loadError={overviewError ? 'Failed to load accounts' : null}
          platform="google"
        />
        <MetaAdsPacerFilterSidebar
          open={filterSidebarOpen}
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          onChange={setFilters}
          users={directoryUsers}
          ads={(overviewData?.accounts ?? []).flatMap((a) => a.ads)}
          currentUserId={currentUserId}
        />
      </div>
    );
  }

  // The plan toolbar: search, sync, and Add Plan. Defined once and placed by the
  // active tab — the planner keeps it in its header row, the pacing card takes it
  // as a prop so it sits with the table it acts on rather than above the whole card.
  const planActions = (
    <div className="flex items-center gap-2">
      {connected && (
        <Tooltip label="Sync actual spend from Google">
          <button
            type="button"
            onClick={syncFromGoogle}
            disabled={syncing || frozen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Sync from Google"
          >
            <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
      )}
      {!frozen && (
        <AddPlanButton
          onCreateNew={() => setBulkAddOpen(true)}
          onOpenCopy={() => setShowCopyModal(true)}
          onImport={connected ? () => setImportOpen(true) : undefined}
          importIcon={<GoogleAdsBrandIcon className="h-4 w-4" />}
          importLabel="Import from Google"
          importHint="Bring existing Google campaigns in as rows"
          createLabel="Add campaign"
          createHint="Name, budget and flight dates — one row per campaign"
          hasOtherPeriods={otherPeriodsWithAds}
        />
      )}
    </div>
  );

  return (
    <PacerReadOnlyContext.Provider value={frozen}>
    {/* Height is NOT pinned to the viewport. `h-full` here made this a
        fixed-height flex column, so the last child — the plan table — got
        shrunk to whatever space was left (185px against 756px of rows) and
        clipped, with nothing able to scroll it. Growing to content and letting
        the app shell's own overflow-y-auto do the scrolling is what Meta's
        planner does. */}
    <div className="flex flex-col pb-2">
      <Header
        tab={tab}
        onTab={setTab}
        accountKey={accountKey}
        period={period}
        onShiftPeriod={(d) => setPeriod((p) => shiftPeriod(p, d))}
        notesCount={notesCount}
        onOpenNotes={() =>
          setNotesTarget({ accountKey, label: accountData?.dealer ?? accountKey })
        }
        filtersActive={activeFilterCount(filters)}
        filtersOpen={filterSidebarOpen}
        // Filters apply to the ad list — planner & pacing only, not reconcile.
        onToggleFilters={
          tab === 'reconcile' ? undefined : () => setFilterSidebarOpen((o) => !o)
        }
      />

      {/* Scope row — account avatar + name + status battery, mirroring
          Meta. Keeps the tool name in the header and the account identity here. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* No box, and the logo runs at its own aspect. A dealer wordmark is
            wide; squeezing it into a 56px square with a 15% inset rendered it a
            few pixels tall and unreadable. `auto` fixes the height and lets the
            width follow, capped so a very wide mark can't push the name off. */}
        <AccountAvatar
          name={accountData?.dealer ?? accountKey}
          accountKey={accountKey}
          logos={accountData?.logos ?? undefined}
          size={52}
          aspect="auto"
          maxWidth={200}
          logoInsetClassName="p-0"
          className="flex-shrink-0"
        />
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="truncate text-2xl font-bold leading-tight text-[var(--foreground)]">
            {accountData?.dealer ?? accountKey}
          </span>
          {plan && plan.ads.length > 0 && <StatusBattery ads={plan.ads} />}
        </div>
      </div>

        {/* The account's pace verdict, beside the account it is about. It used
            to lead a stats strip lower down, where the one sentence a rep
            repeats to a client sat below the fold of its own card. The Pacing
            tab computes it and hands it up (see GooglePacingCard's
            onPaceSummary) so there is exactly one derivation of it. */}
        {/* The VERDICT alone. Spent MTD stood beside it here and was the odd one
            out: a dollar figure keeping company with a one-word judgment, while
            its four peers — expected, left to spend, daily needed, days left —
            sat together in cards below. It reads with them. */}
        {tab === 'pacing' && pace && (
          <div className="flex-shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {pace.scope ? 'Campaign pace' : 'Account pace'}
            </div>
            <div
              className="text-2xl font-bold leading-tight tracking-tight"
              style={{ color: PACE_COLORS[pace.status] }}
            >
              {ACCOUNT_PACE_LABELS[pace.status]}
            </div>
            <div className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
              {pace.ratio != null
                ? `${Math.round(pace.ratio * 100)}% of expected`
                : 'no settled days'}
            </div>
          </div>
        )}
      </div>

      {!connected && (
        <div className="mb-5 mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
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

      {plan && tab === 'planner' && (
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
              platform="google"
            />
            <BudgetPanel
              title="Added Budget"
              source="added"
              color={SHARED_COLORS.added}
              goalKey="addedBudgetGoal"
              plan={plan}
              onChange={onPlanChange}
              platform="google"
            />
          </div>
        </div>
      )}

      {/* Search / sync / add — rendered here for the planner, and handed to the
          pacing card so it can sit directly above its own table. */}
      {tab === 'planner' && (
        <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold tracking-tight text-[var(--foreground)]">
            Campaigns · {periodLabel(period)}{' '}
            <span className="font-normal text-[var(--muted-foreground)]">({ads.length})</span>
          </span>
          {planActions}
        </div>
      )}

      {tab === 'reconcile' ? (
        // Reconciliation tab — year settlement + the per-ad Over/Under view,
        // toggled (mirrors Meta). Both scoped to Google's own ledger.
        <div>
          <div className="mb-5 inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {(
              [
                ['recon', 'Reconciliation'],
                ['compare', 'Over / Under'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setReconView(v)}
                aria-pressed={reconView === v}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  reconView === v
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--primary)]" />
            <span>
              Actuals are <span className="font-medium text-[var(--foreground)]">served</span> cost
              (metrics.cost_micros), not billed. Every daily campaign bills continuously, so its
              spend settles in-month — nothing is deferred to month-end. Should-have-spent is just
              client budget × margin.
            </span>
          </div>
          {reconView === 'compare' ? (
            <ComparePanel accountKey={accountKey} period={period} platform="google" />
          ) : (
            <ReconciliationPanel accountKey={accountKey} platform="google" />
          )}
        </div>
      ) : !isLoading && ads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No Google campaigns for {periodLabel(period)} yet.
          {!frozen && ' Add one, or sync from Google.'}
        </div>
      ) : tab === 'pacing' ? (
        // Pacing tab — the top-down allocator card (google-pacing-card spec).
        // Replaces the per-campaign island-budget pacer: the account's payable is
        // the source and every campaign's daily is derived from its share of it.
        <div className="mt-1">
          {plan && (
            <GooglePacingCard
              onPaceSummary={setPace}
              accountKey={accountKey}
              period={period}
              plan={plan}
              ads={ads}
              visibleAds={visibleAds}
              timeZone={tz}
              frozen={frozen}
              onPersist={persistCard}
              onPushBudgets={pushAllBudgets}
              pushing={pushingBudgets}
              googleConnected={connected}
              tableActions={planActions}
              onSyncFromGoogle={syncFromGoogle}
              syncing={syncing}
            />
          )}
        </div>
      ) : (
        // Plan view — Meta-style table of AdSummaryRow.
        <div className="glass-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-14 pl-2 pr-1 py-2" />
                {[
                  'Ad',
                  '',
                  'Ad Status',
                  'Due Date',
                  'Budget',
                  'Allocation',
                  'Flight Dates',
                  'Design',
                  'Approvals',
                ].map((h, i) => (
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
              {visibleAds.map((ad, i) => (
                <AdSummaryRow
                  key={ad.id}
                  ad={ad}
                  index={i}
                  onOpen={() => !frozen && setEditing(ad)}
                  onUpdate={frozen ? undefined : updateAd}
                  onRemove={() => deleteCampaign(ad)}
                  onClone={() => cloneCampaign(ad.id)}
                  isSelected={false}
                  onSelectToggle={() => {}}
                />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {editing && (
        <AdEditorModal
          initialAd={editing === 'new' ? makeAd(ads.length, period) : editing}
          markup={data?.markup ?? null}
          liveActivityLog={
            editing === 'new'
              ? []
              : ads.find((a) => a.id === editing.id)?.activityLog ?? editing.activityLog
          }
          mode={editing === 'new' ? 'create' : 'edit'}
          users={directoryUsers}
          currentUserId={currentUserId}
          onSave={saveCampaign}
          onCancel={() => setEditing(null)}
          onAddActivity={onAddActivity}
          onEditActivity={onEditActivity}
          onDeleteActivity={onDeleteActivity}
          platform="google"
          editorExtraFields={(ad, onUpdate) => (
            <Field label="Channel">
              <SearchableSelect
                value={ad.googleChannelType ?? 'Search'}
                onChange={(v) => onUpdate({ ...ad, googleChannelType: v })}
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            </Field>
          )}
        />
      )}

      {bulkAddOpen && plan && (
        <BulkAddAdsModal
          plan={plan}
          onClose={() => setBulkAddOpen(false)}
          onCreate={(newAds) => {
            persist([...ads, ...newAds]);
            setBulkAddOpen(false);
            toast.success(`Added ${newAds.length} campaign${newAds.length === 1 ? '' : 's'}`);
          }}
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

      {showCopyModal && accountKey && (
        <CopyPlanModal
          accountKey={accountKey}
          targetPeriod={period}
          periods={periods}
          platform="google"
          onClose={() => setShowCopyModal(false)}
          onCopy={handleCopyFrom}
        />
      )}

      {notesTarget && (
        <AccountNotesDrawer
          accountKey={notesTarget.accountKey}
          accountLabel={notesTarget.label}
          period={period}
          users={directoryUsers}
          currentUserId={currentUserId}
          platform="google"
          onClose={() => setNotesTarget(null)}
          // Only reflect the count back into the page-title badge when the open
          // drawer is for the currently-selected account.
          onCountChange={(c) => {
            if (notesTarget.accountKey === accountKey) setNotesCount(c);
          }}
        />
      )}

      <MetaAdsPacerFilterSidebar
        open={filterSidebarOpen}
        onClose={() => setFilterSidebarOpen(false)}
        filters={filters}
        onChange={setFilters}
        users={directoryUsers}
        ads={ads}
        currentUserId={currentUserId}
      />
    </div>
    </PacerReadOnlyContext.Provider>
  );
}

function Header({
  tab,
  onTab,
  accountKey,
  period,
  onShiftPeriod,
  notesCount,
  onOpenNotes,
  filtersActive = 0,
  filtersOpen = false,
  onToggleFilters,
}: {
  tab: 'planner' | 'pacing' | 'reconcile';
  onTab: (t: 'planner' | 'pacing' | 'reconcile') => void;
  accountKey: string | null;
  period?: string;
  onShiftPeriod?: (delta: number) => void;
  // Notes icon sits to the LEFT of the period selector (subaccount view only,
  // mirroring Meta). Filters sits to the RIGHT.
  notesCount?: number | null;
  onOpenNotes?: () => void;
  filtersActive?: number;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
}) {
  const subtitle =
    tab === 'planner'
      ? 'Plan & allocate your monthly Google ad budgets'
      : tab === 'pacing'
        ? 'Track spend pacing across the active period'
        : 'Settle monthly over/under and reconcile the year';
  return (
    <div className="page-sticky-header mb-8">
      <div className="flex items-center justify-between gap-4">
        {/* Left: tool name (account identity sits in the scope row below). */}
        <div className="flex min-w-0 items-center gap-3">
          <GoogleAdsBrandIcon className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold text-[var(--foreground)]">Google Ads</h2>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
          </div>
        </div>
        {/* Right: notes · month selector · filters (mirrors Meta). */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Account notes — left of the selector, subaccount view only. */}
          {accountKey && onOpenNotes && (
            <AccountNotesButton
              count={notesCount ?? null}
              onClick={onOpenNotes}
              ariaLabel="Account notes for this month"
            />
          )}
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
          {/* Filters — right of the selector. */}
          {onToggleFilters && (
            <button
              type="button"
              onClick={onToggleFilters}
              aria-pressed={filtersOpen}
              aria-expanded={filtersOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                filtersOpen
                  ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary)]'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              <FunnelIcon className="h-3.5 w-3.5" />
              Filters
              {filtersActive > 0 && (
                <span
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                  style={{ background: 'var(--primary)', color: 'white' }}
                >
                  {filtersActive}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Flat tab bar — Planner · Pacing · Reconciliation (mirrors Meta). Only
          with an account selected (every tab needs one). */}
      {accountKey && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {(
            [
              ['planner', 'Planner', ClipboardDocumentListIcon],
              ['pacing', 'Pacing', AdjustmentsHorizontalIcon],
              ['reconcile', 'Reconciliation', InvestmentIcon],
            ] as const
          ).map(([t, label, Icon]) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}
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
  shared: boolean;
  sharedCount: number | null;
  budgetConstrained: boolean;
  adsDisapproved: boolean;
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
                          {c.shared && (
                            <span
                              className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{ background: 'rgba(125,184,232,0.16)', color: '#7db8e8' }}
                            >
                              Shared{c.sharedCount ? ` ×${c.sharedCount}` : ''}
                            </span>
                          )}
                          {c.adsDisapproved && (
                            <span
                              className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{ background: 'rgba(248,113,113,0.16)', color: '#f87171' }}
                            >
                              Disapproved
                            </span>
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
