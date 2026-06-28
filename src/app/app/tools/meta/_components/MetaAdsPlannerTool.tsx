'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AdjustmentsHorizontalIcon,
  TableCellsIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  FunnelIcon,
  ArrowPathIcon,
  ScaleIcon,
  LockClosedIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { AccountAvatar } from '@/components/account-avatar';
// Shared searchable people picker (search + avatars). Aliased — this file has
// its own department-filtered native-select `UserPicker` used by the planner
// form; the import modal wants the searchable one.
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { InvestmentIcon } from '@/components/icons/investment';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { DEFAULT_TIME_ZONE } from '@/lib/timezone';
import {
  CARRYOVER_THRESHOLD,
  COLORS,
} from '@/lib/ad-pacer/constants';
import {
  buildAdCalc,
  buildPacerCalc,
  isLifetimeInProgress,
  effectiveActual,
} from '@/lib/ad-pacer/pacer-calc';
import type {
  DirectoryUser,
  ActivityEntry,
  PacerAd,
  PacerPlan,
  PriorOverUnder,
  PeriodSummary,
  SaveStatus,
} from '@/lib/ad-pacer/types';
import { effectiveSpendTarget } from '@/lib/ad-pacer/markup';
import {
  fmt,
  fmtSyncedAgo,
  effMarkupOf,
  adContribution,
} from '@/lib/ad-pacer/helpers';
import {
  currentPeriod,
  isValidPeriod,
  shiftPeriod,
  fmtPeriodLong,
  fmtPeriodShort,
} from '@/lib/ad-pacer/period';
import {
  type PlanFilters,
  EMPTY_FILTERS,
  applyFilters,
  activeFilterCount,
} from '@/lib/ad-pacer/filters';
import {
  PacerReadOnlyContext,
  Tooltip,
  PeriodSelector,
  StatusBattery,
  AccountNotesButton,
  BudgetPanel,
  TotalAllocationHeader,
} from '@/app/app/tools/_shared';
import {
  ReconciliationPanel,
  ComparePanel,
  OverviewView,
  type OverviewAccount,
} from './ReconciliationViews';
import { AccountNotesDrawer, type AccountNote } from './AccountNotesDrawer';
import { BudgetLogDrawer, ChangeLogDrawer, type AdSnapshot } from './BudgetLogDrawer';
import { ImportFromMetaModal } from './ImportFromMetaModal';
import { AdPlannerPanel } from './AdPlannerPanel';
import { MetaAdsPacerFilterSidebar } from './FilterSidebar';
import { type CopyFieldOptions } from './CopyPlanModal';
import { SummaryPanel } from '@/app/app/tools/_shared';
import { BudgetPacerPanel, PacerSpendTotals, type AccountPacing } from './BudgetPacerPanel';

// ─── Constants ─────────────────────────────────────────────────────────────
// Status/option lists + color maps now live in @/lib/ad-pacer/constants (imported above).

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};





// ─── Filter UI: status indicator + slide-from-right sidebar ────────────────


// `buildAdCalc` / `AdCalc` and `buildPacerCalc` / `PacerCalc` are the shared
// pacing math (imported from ../_lib/pacer-calc) — one source of truth so the
// Pacer and Summary views can never drift. They take the current instant
// (`Date.now()`) and the account's IANA `timeZone` (plan.timeZone).

// ─── Plan Ad Card (rich Monday-mapped editor) ──────────────────────────────


// ─── Ad Planner panel ──────────────────────────────────────────────────────


// ─── Budget Log ───────────────────────────────────────────────────────────
// Point-in-time snapshots of the per-ad pacer numbers (mirrors the
// Summary tab columns). Reps log entries while reviewing the monthly
// pacer to track when budgets were checked or adjusted.


// Small chat-bubble button that opens the account-level notes modal.
// The count badge surfaces when there's at least one note so reps can
// see at a glance which accounts have unread context.


// ─── Pacer row ─────────────────────────────────────────────────────────────


// Meta-specific slots injected into the shared <PacerRow>. Kept here (not in
// _shared) because they read Meta-only fields (metaStartDate/End,
// metaEffectiveStatus) — the Google tool passes its own equivalents.

/** Run-window tooltip beside the link control; null when there's no Meta run. */
type MetaToolMode = 'planner' | 'pacer';
type PacerInnerTab = 'pacer' | 'summary' | 'compare';
// Planner page sub-tabs: the planner itself + the Reconciliation view
// (moved here from the Pacer page).
type PlannerInnerTab = 'planner' | 'reconcile';

export function MetaAdsPlannerTool({ mode: initialMode }: { mode: MetaToolMode }) {
  const { accountKey, accounts, setAccount } = useAccount();
  const { data: session } = useSession();
  const { markDirty, markClean } = useUnsavedChanges();
  const { confirm } = useLoomiDialog();
  const currentUserId = session?.user?.id ?? null;

  const activeKey = accountKey;
  const activeAccount = activeKey ? accounts[activeKey] : null;

  // ── URL state: period (and pacerTab on the Ad Pacer page) sync to/from
  //    query params so reload and bookmarks survive. Filters and view-mode
  //    stay in local state.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPeriod = searchParams.get('period');
  const urlPacerTab = searchParams.get('pacerTab');
  const urlPlannerTab = searchParams.get('plannerTab');
  const urlView = searchParams.get('view');

  // Planner + Pacer are one consolidated page now; `mode` is switchable state
  // (seeded from ?view= or the route default) and mirrors back to the URL via
  // the sync effect below, so the Plan/Pace toggle is bookmarkable.
  const [mode, setMode] = useState<MetaToolMode>(
    urlView === 'pacer' ? 'pacer' : urlView === 'planner' ? 'planner' : initialMode,
  );

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [period, setPeriod] = useState<string>(
    urlPeriod && isValidPeriod(urlPeriod) ? urlPeriod : currentPeriod(),
  );
  const [periodSummaries, setPeriodSummaries] = useState<PeriodSummary[]>([]);
  const [plan, setPlan] = useState<PacerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Autosave still tracks status via setSaveStatus; the visible indicator was
  // removed from the header, so the value itself is no longer read.
  const [, setSaveStatus] = useState<SaveStatus>('idle');
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [applyingCarryover, setApplyingCarryover] = useState(false);
  const [carryoverBucket, setCarryoverBucket] = useState<'base' | 'added'>('base');
  const [carryoverDismissed, setCarryoverDismissed] = useState(false);
  // Budget Log + Change Log now live in the account scope row (pacer), so
  // their open-state + drawers are lifted here and work on every pacer sub-tab.
  const [budgetLogOpen, setBudgetLogOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  // "Import from Meta" onboarding modal (available in planner + pacer).
  const [importOpen, setImportOpen] = useState(false);
  const adsSnapshot = useMemo<AdSnapshot[]>(
    () =>
      plan
        ? plan.ads.map((ad) => {
            const c = buildAdCalc(ad, Date.now(), plan.timeZone);
            return {
              adId: ad.id,
              adName: ad.name || 'Untitled Ad',
              budgetType: ad.budgetType,
              budgetSource: ad.budgetSource,
              budget: c.totalBudget,
              projected: c.projected,
              actual: c.actual,
              target: c.target,
              recDaily: c.recDaily,
            };
          })
        : [],
    [plan],
  );
  const [pacerTab, setPacerTab] = useState<PacerInnerTab>(
    urlPacerTab === 'summary'
      ? 'summary'
      : urlPacerTab === 'compare'
        ? 'compare'
        : 'pacer',
  );
  const [plannerTab, setPlannerTab] = useState<PlannerInnerTab>(
    urlPlannerTab === 'reconcile' ? 'reconcile' : 'planner',
  );

  // Mirror state changes back into the URL (replace, not push, so the
  // back button stays useful for actual navigation).
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('period', period);
    next.set('view', mode);
    if (mode === 'pacer') next.set('pacerTab', pacerTab);
    else next.delete('pacerTab');
    if (mode === 'planner') next.set('plannerTab', plannerTab);
    else next.delete('plannerTab');
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
    // Intentionally exclude `searchParams` so external param changes don't
    // re-trigger this loop (we read from it once on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, pacerTab, plannerTab, mode, pathname, router]);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  // Lifted overview list — fetched once per period when there's no
  // active account so the parent can also wire the filter sidebar's
  // `ads` prop on the admin overview. OverviewView consumes this via
  // props instead of owning the fetch.
  const [overviewAccounts, setOverviewAccounts] = useState<OverviewAccount[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  useEffect(() => {
    if (activeKey) return; // only relevant for the admin overview
    let cancelled = false;
    setOverviewAccounts(null);
    setOverviewError(null);
    fetch(`/api/meta-ads-pacer/overview?period=${period}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<{ accounts: OverviewAccount[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setOverviewAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] overview load failed', err);
        setOverviewError(err instanceof Error ? err.message : 'Failed to load overview');
      });
    return () => {
      cancelled = true;
    };
  }, [period, activeKey]);
  // Flatten every overview account's ads so the filter sidebar can
  // surface accurate Quick View counts + account-rep options on the
  // admin overview (when there's no per-account `plan` to draw from).
  const overviewAds = useMemo(
    () => (overviewAccounts ?? []).flatMap((a) => a.ads),
    [overviewAccounts],
  );
  // True while the AdEditorModal is open. Pauses autosave so transient draft
  // edits don't get persisted until the user clicks Save.
  const [editorOpen, setEditorOpen] = useState(false);
  // Account-level notes modal — opened from the chat icon next to the
  // period selector. Count fetched on activeKey change so the badge can
  // surface "this account has notes" without opening the panel.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  useEffect(() => {
    if (!accountKey) {
      setNotesCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/notes?period=${period}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((data: { notes?: AccountNote[] }) => {
        if (cancelled) return;
        setNotesCount(Array.isArray(data.notes) ? data.notes.length : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setNotesCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  // ── Fetch directory of users (once) ──
  useEffect(() => {
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
      })
      .catch(() => {
        // tolerate failure — pickers will just show empty list
      });
  }, []);

  // ── Load plan whenever active account or period changes ──
  useEffect(() => {
    if (!activeKey) {
      setPlan(null);
      setLoadError(null);
      setLoaded(true);
      setPeriodSummaries([]);
      setFilters(EMPTY_FILTERS);
      return;
    }
    setLoaded(false);
    setLoadError(null);
    setFilters(EMPTY_FILTERS);
    setCarryoverDismissed(false);
    setCarryoverBucket('base');

    Promise.all([
      fetch(`/api/meta-ads-pacer/${activeKey}?period=${period}`).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<PacerPlan>;
      }),
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .catch(() => ({ periods: [] })) as Promise<{ periods: PeriodSummary[] }>,
    ])
      .then(([planData, periodsData]) => {
        setPlan({
          accountKey: planData.accountKey ?? activeKey,
          period: planData.period ?? period,
          baseBudgetGoal: planData.baseBudgetGoal ?? null,
          addedBudgetGoal: planData.addedBudgetGoal ?? null,
          markup:
            typeof planData.markup === 'number' &&
            Number.isFinite(planData.markup)
              ? planData.markup
              : null,
          timeZone:
            typeof planData.timeZone === 'string' && planData.timeZone
              ? planData.timeZone
              : DEFAULT_TIME_ZONE,
          frozen: planData.frozen === true,
          frozenAt: planData.frozenAt ?? null,
          reopened: planData.reopened === true,
          baseCarryover: planData.baseCarryover ?? null,
          addedCarryover: planData.addedCarryover ?? null,
          priorOverUnder: planData.priorOverUnder ?? null,
          ads: Array.isArray(planData.ads) ? planData.ads : [],
          siblingsByName: planData.siblingsByName,
        });
        setPeriodSummaries(
          Array.isArray(periodsData?.periods) ? periodsData.periods : [],
        );
        setLoaded(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] failed to load plan', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load plan');
        setLoaded(true);
      });
  }, [activeKey, period]);

  // ── Debounced save (PUT) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  // Reset save dedupe when account/period changes so the first edit triggers a save
  useEffect(() => {
    lastSavedRef.current = '';
  }, [activeKey, period]);

  useEffect(() => {
    if (!loaded || !activeKey || !plan) return;
    // A frozen (closed) month is read-only — never autosave it. The server
    // also rejects the write, but suppressing here avoids failed-save churn.
    if (plan.frozen) return;
    // Pause autosave while the editor modal is open so partial drafts aren't
    // persisted; the modal commits via its own Save handler instead.
    if (editorOpen) return;
    const serialized = JSON.stringify({
      baseBudgetGoal: plan.baseBudgetGoal,
      addedBudgetGoal: plan.addedBudgetGoal,
      ads: plan.ads.map((a, i) => ({ ...a, position: i, period })),
    });
    if (serialized === lastSavedRef.current) return;

    // Local plan diverged from the last-saved baseline — flag the global
    // unsaved-changes guard so navigating away mid-edit prompts the user.
    markDirty();
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // Retries the PUT once with backoff before surfacing an error so
      // a transient blip (network hiccup, cold lambda) doesn't strand the
      // user with a red dot. Both attempts use the same serialized body —
      // saves are idempotent at this granularity.
      const attemptSave = async (attempt = 0): Promise<boolean> => {
        try {
          const res = await fetch(
            `/api/meta-ads-pacer/${activeKey}?period=${period}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: serialized,
            },
          );
          if (!res.ok) throw new Error('save failed');
          // Don't replace local state with the server response — the user may
          // have typed more during the 600ms debounce + network round-trip,
          // and overwriting would clobber those keystrokes.
          await res.json().catch(() => null);
          return true;
        } catch {
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return attemptSave(attempt + 1);
          }
          return false;
        }
      };
      const ok = await attemptSave();
      if (ok) {
        lastSavedRef.current = serialized;
        setSaveStatus('saved');
        markClean();
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else {
        setSaveStatus('error');
      }
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [plan, activeKey, loaded, period, markClean, markDirty, editorOpen]);

  // ── Sync actual spend from Facebook ──
  // Pulls per-campaign spend for the current period and drops the refreshed
  // plan straight into state. Linked rows (or rows whose name matches a
  // campaign) get their pacerActual overwritten by Facebook's number; the
  // existing autosave effect persists the result.
  const handleSyncMeta = async (opts?: { auto?: boolean }) => {
    if (!activeKey || syncingMeta) return;
    // Auto = the silent background refresh on load (stale-while-revalidate):
    // no toasts, and the route skips the audit entry. The button spinner is
    // the only surfaced signal.
    const auto = opts?.auto === true;
    setSyncingMeta(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/sync-meta?period=${period}${auto ? '&auto=1' : ''}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!auto) toast.error(data?.error || 'Meta sync failed.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      // Background refresh: the rows just updated silently — no toasts.
      if (auto) return;
      const sync = data.sync as
        | { matched: number; total: number; results: { matched: boolean; name: string }[] }
        | undefined;
      if (!sync || sync.total === 0) {
        toast.success('Synced — no ads to match for this period yet.');
      } else if (sync.matched === 0) {
        toast.error(
          'No ads matched a Meta campaign. Name a pacer ad exactly like its campaign, then sync again.',
        );
      } else {
        const unmatched = sync.results
          .filter((r) => !r.matched)
          .map((r) => r.name || 'Untitled');
        toast.success(
          `Synced spend for ${sync.matched} of ${sync.total} ad${
            sync.total === 1 ? '' : 's'
          } from Meta.${
            unmatched.length ? ` Unmatched: ${unmatched.join(', ')}.` : ''
          }`,
        );
      }
    } catch {
      if (!auto) toast.error('Meta sync failed.');
    } finally {
      setSyncingMeta(false);
    }
  };

  // ── Auto-refresh from Meta on load (stale-while-revalidate) ──
  // The pacer renders from cached DB rows immediately; once loaded, if the
  // linked ads' spend is stale we fire ONE silent background sync. Latest sync
  // fn + plan live in refs so the effect fires once per account/period load
  // without re-running on every plan edit or chasing the fn's identity.
  const autoSyncFnRef = useRef<(opts?: { auto?: boolean }) => void>(() => {});
  autoSyncFnRef.current = handleSyncMeta;
  const planRef = useRef<PacerPlan | null>(null);
  planRef.current = plan;
  // Per account+period cooldown so a sync that keeps failing can't re-fire on
  // every render — it retries at most once per stale window.
  const autoSyncAttemptRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (mode !== 'pacer' || !activeKey || !loaded) return;
    const p = planRef.current;
    if (!p || p.frozen) return;
    // Only ad sets actually linked to Meta can be refreshed.
    const linked = p.ads.filter((a) => a.metaObjectId);
    if (linked.length === 0) return;
    const STALE_MS = 15 * 60 * 1000;
    const now = Date.now();
    const anyNeverSynced = linked.some((a) => !a.pacerSyncedAt);
    const freshest = linked.reduce((max, a) => {
      const t = a.pacerSyncedAt ? Date.parse(a.pacerSyncedAt) : NaN;
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    if (!anyNeverSynced && now - freshest <= STALE_MS) return; // still fresh
    const key = `${activeKey}:${period}`;
    const last = autoSyncAttemptRef.current.get(key) ?? 0;
    if (now - last < STALE_MS) return; // attempted recently — don't loop
    autoSyncAttemptRef.current.set(key, now);
    autoSyncFnRef.current({ auto: true });
  }, [activeKey, period, loaded, mode]);

  // ── Apply the refreshed plan returned by the "Import from Meta" modal ──
  // The import route returns the same period view as a sync, so the rows drop
  // straight into state (the modal owns its own toast + close).
  const handleImported = (raw: unknown) => {
    const data = (raw ?? {}) as Record<string, unknown>;
    setPlan({
      accountKey: (data.accountKey as string) ?? activeKey ?? '',
      period: (data.period as string) ?? period,
      baseBudgetGoal: (data.baseBudgetGoal as string | null) ?? null,
      addedBudgetGoal: (data.addedBudgetGoal as string | null) ?? null,
      markup:
        typeof data.markup === 'number' && Number.isFinite(data.markup)
          ? (data.markup as number)
          : null,
      timeZone:
        typeof data.timeZone === 'string' && data.timeZone
          ? (data.timeZone as string)
          : DEFAULT_TIME_ZONE,
      frozen: data.frozen === true,
      frozenAt: (data.frozenAt as string | null) ?? null,
      reopened: data.reopened === true,
      baseCarryover: (data.baseCarryover as string | null) ?? null,
      addedCarryover: (data.addedCarryover as string | null) ?? null,
      priorOverUnder: (data.priorOverUnder as PriorOverUnder | null) ?? null,
      ads: Array.isArray(data.ads) ? (data.ads as PacerAd[]) : [],
      siblingsByName: data.siblingsByName as PacerPlan['siblingsByName'],
    });
  };

  // ── Reopen a frozen (closed) month for correction (admin escape hatch) ──
  const handleReopenMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/reopen?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not reopen this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      // Re-enable autosave from the reopened baseline.
      lastSavedRef.current = '';
      toast.success(
        `${fmtPeriodLong(period)} reopened for editing. The original snapshot is kept; it re-freezes on the next close.`,
      );
    } catch {
      toast.error('Could not reopen this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Re-freeze a reopened month once corrections are done ──
  const handleRefreezeMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/freeze?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not re-freeze this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      toast.success(`${fmtPeriodLong(period)} re-frozen.`);
    } catch {
      toast.error('Could not re-freeze this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Apply / clear last month's carryover into this month (Change 7) ──
  const handleApplyCarryover = async (
    bucket: 'base' | 'added',
    clear: boolean,
  ) => {
    if (!activeKey || applyingCarryover) return;
    setApplyingCarryover(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/carryover?period=${period}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, clear }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not update carryover.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      toast.success(
        clear
          ? 'Carryover removed.'
          : `Carried last month's over/under into ${bucket === 'base' ? 'Base' : 'Added'}.`,
      );
    } catch {
      toast.error('Could not update carryover.');
    } finally {
      setApplyingCarryover(false);
    }
  };

  // ── Copy from another period ──
  const handleCopyFrom = async (
    fromPeriod: string,
    adIds: string[] | undefined,
    fields: CopyFieldOptions,
  ) => {
    if (!activeKey || !fromPeriod || fromPeriod === period) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/meta-ads-pacer/${activeKey}/copy-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromPeriod,
          to: period,
          fields,
          ...(adIds && adIds.length > 0 ? { adIds } : {}),
        }),
      });
      if (!res.ok) throw new Error('copy failed');
      const updated = (await res.json()) as PacerPlan;
      setPlan({
        accountKey: updated.accountKey ?? activeKey,
        period: updated.period ?? period,
        baseBudgetGoal: updated.baseBudgetGoal ?? null,
        addedBudgetGoal: updated.addedBudgetGoal ?? null,
        markup:
          typeof updated.markup === 'number' && Number.isFinite(updated.markup)
            ? updated.markup
            : null,
        timeZone:
          typeof updated.timeZone === 'string' && updated.timeZone
            ? updated.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: updated.frozen === true,
        frozenAt: updated.frozenAt ?? null,
        reopened: updated.reopened === true,
        baseCarryover: updated.baseCarryover ?? null,
        addedCarryover: updated.addedCarryover ?? null,
        priorOverUnder: updated.priorOverUnder ?? null,
        ads: Array.isArray(updated.ads) ? updated.ads : [],
        siblingsByName: updated.siblingsByName,
      });
      lastSavedRef.current = JSON.stringify({
        baseBudgetGoal: updated.baseBudgetGoal,
        addedBudgetGoal: updated.addedBudgetGoal,
        ads: (updated.ads ?? []).map((a, i) => ({ ...a, position: i, period })),
      });
      // Refresh periods list (target now has ads)
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .then((data: { periods: PeriodSummary[] }) =>
          setPeriodSummaries(Array.isArray(data?.periods) ? data.periods : []),
        )
        .catch(() => {});
      setSaveStatus('saved');
      markClean();
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Activity log handlers (per-event endpoints) ──
  const onAddActivity = async (adId: string, text: string, file: File | null) => {
    if (!activeKey) return;
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', file);
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        body: fd,
      });
    } else {
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId ? { ...a, activityLog: [...a.activityLog, entry] } : a,
            ),
          }
        : p,
    );
  };

  const onEditActivity = async (adId: string, entryId: string, text: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? {
                    ...a,
                    activityLog: a.activityLog.map((x) =>
                      x.id === entryId ? entry : x,
                    ),
                  }
                : a,
            ),
          }
        : p,
    );
  };

  const onDeleteActivity = async (adId: string, entryId: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? { ...a, activityLog: a.activityLog.filter((x) => x.id !== entryId) }
                : a,
            ),
          }
        : p,
    );
  };

  // ── Header totals ──
  const totals = useMemo(() => {
    if (!plan) return { base: 0, added: 0, actual: 0 };
    let base = 0;
    let added = 0;
    let actual = 0;
    plan.ads.forEach((ad) => {
      const c = adContribution(ad);
      base += c.baseAllocation;
      added += c.addedAllocation;
      // §2: a resolved straddler counts its full run in its own month.
      actual += effectiveActual(ad);
    });
    return { base, added, actual };
  }, [plan]);

  // Account-wide pacing for the Pacer's scope-row "Spend Progress" readout —
  // lifted here (from the pacer panel) so the metrics can live in the scope
  // row. Live month = neutral progress; frozen = final variance. In-progress
  // lifetime ads are excluded from both sides (mirrors the Over/Under page).
  const pacerAccountPacing = useMemo<AccountPacing | null>(() => {
    if (!plan) return null;
    const nowMs = Date.now();
    const gross =
      (num(plan.baseBudgetGoal) ?? 0) + (num(plan.addedBudgetGoal) ?? 0);
    const carry =
      (num(plan.baseCarryover) ?? 0) + (num(plan.addedCarryover) ?? 0);
    const target = effectiveSpendTarget(gross, effMarkupOf(plan.markup), carry);
    let ipLifeActual = 0;
    let ipLifeAlloc = 0;
    for (const ad of plan.ads) {
      if (!isLifetimeInProgress(ad, nowMs, plan.timeZone)) continue;
      ipLifeActual += effectiveActual(ad);
      ipLifeAlloc += num(ad.allocation) ?? 0;
    }
    const baseTarget = target - ipLifeAlloc;
    const baseSpent = totals.actual - ipLifeActual;
    if (baseTarget <= 0) return null;
    if (plan.frozen) {
      const pct = (baseSpent / baseTarget) * 100;
      const delta = pct - 100;
      const status =
        Math.abs(delta) < 0.5 ? 'on-track' : delta > 0 ? 'over' : 'under';
      return { mode: 'final', pct, status, spent: baseSpent, target: baseTarget, dayElapsed: 0, dayTotal: 0 };
    }
    const now = new Date(nowMs);
    const [py, pm] = plan.period.split('-').map(Number);
    const dayTotal = new Date(py, pm, 0).getDate();
    const todayMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayElapsed =
      todayMonth === plan.period ? now.getDate() : todayMonth > plan.period ? dayTotal : 0;
    return { mode: 'progress', pct: (baseSpent / baseTarget) * 100, status: 'neutral', spent: baseSpent, target: baseTarget, dayElapsed, dayTotal };
  }, [plan, totals.actual]);

  // Bulk "Set all dailies to Rec." — lifted here (from the pacer panel) so the
  // button can sit beside Sync in the shared action cluster. Applies the
  // recommended daily to every visible non-lifetime, non-stopped ad with a
  // valid recDaily; shows a per-ad before → after preview first.
  const pacerVisibleAds = useMemo(
    () => (plan ? applyFilters(plan.ads, filters, currentUserId) : []),
    [plan, filters, currentUserId],
  );
  const bulkSetDailies = async () => {
    if (!plan || plan.frozen) return;
    const nowMs = Date.now();
    const candidates = pacerVisibleAds.filter((ad) => {
      if (ad.budgetType !== 'Daily') return false;
      if (ad.adStatus === 'Off' || ad.adStatus === 'Completed Run') return false;
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      return c.daysLeft > 0 && c.budget > 0 && c.recDaily > 0;
    });
    if (candidates.length === 0) {
      toast.error('No visible ads have a recommended daily to apply');
      return;
    }
    const bigJumps = candidates.filter((ad) => {
      const current = num(ad.pacerDailyBudget) ?? 0;
      if (current <= 0) return false;
      const rec = buildPacerCalc(ad, nowMs, plan.timeZone).recDaily;
      return Math.abs(rec - current) / current > 0.2;
    });
    const adWord = candidates.length === 1 ? 'ad' : 'ads';
    const rows = candidates.map((ad) => {
      const current = num(ad.pacerDailyBudget) ?? 0;
      const rec = buildPacerCalc(ad, nowMs, plan.timeZone).recDaily;
      return {
        id: ad.id,
        name: ad.name || 'Untitled Ad',
        current,
        rec,
        isBig: current > 0 && Math.abs(rec - current) / current > 0.2,
      };
    });
    const body = (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--foreground)]">
                  {r.name}
                </div>
                {r.isBig && (
                  <span
                    className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(245,158,11,0.15)', color: COLORS.warn }}
                  >
                    <ExclamationTriangleIcon className="h-3 w-3" />
                    &gt;20% jump
                  </span>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 text-sm">
                <span className="text-[var(--muted-foreground)]">
                  {r.current > 0 ? `${fmt(r.current)}/day` : 'not set'}
                </span>
                <span className="text-[var(--muted-foreground)]">→</span>
                <span className="font-bold" style={{ color: 'var(--primary)' }}>
                  {fmt(r.rec)}/day
                </span>
              </div>
            </div>
          ))}
        </div>
        {bigJumps.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'rgba(245,158,11,0.1)', color: COLORS.warn }}
          >
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {bigJumps.length}{' '}
              {bigJumps.length === 1 ? 'change is a' : 'changes are'} &gt;20% jump
              — large changes can reset Meta&apos;s learning phase.
            </span>
          </div>
        )}
      </div>
    );
    const ok = await confirm({
      title: 'Set dailies to recommended',
      message: `This will set the daily budget on ${candidates.length} ${adWord}:`,
      body,
      confirmLabel: `Apply to ${candidates.length} ${adWord}`,
    });
    if (!ok) return;
    const candidateIds = new Set(candidates.map((a) => a.id));
    setPlan({
      ...plan,
      ads: plan.ads.map((ad) => {
        if (!candidateIds.has(ad.id)) return ad;
        const c = buildPacerCalc(ad, nowMs, plan.timeZone);
        return { ...ad, pacerDailyBudget: c.recDaily.toFixed(2) };
      }),
    });
    toast.success(
      `Set daily budget on ${candidates.length} ad${candidates.length === 1 ? '' : 's'} to recommended`,
    );
  };

  // Most-recent Meta spend sync across the plan's ads (ISO strings compare
  // chronologically) — surfaced in the Sync button's tooltip.
  const lastSyncedAt = useMemo(
    () =>
      plan
        ? plan.ads.reduce<string | null>((latest, ad) => {
            if (!ad.pacerSyncedAt) return latest;
            return !latest || ad.pacerSyncedAt > latest ? ad.pacerSyncedAt : latest;
          }, null)
        : null,
    [plan],
  );

  // Pacer action buttons (change/budget log + set-all-dailies + Meta
  // import/sync). Built once here so they can render either in the scope row
  // (summary / over-under sub-tabs) or inside the pacer panel's "Spend Pacing"
  // header (passed via headerActions) — wherever the swap puts them per sub-tab.
  const pacerActions =
    mode === 'pacer' && activeKey ? (
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <Tooltip label="Change log" placement="bottom">
          <button
            type="button"
            onClick={() => setChangeLogOpen(true)}
            aria-label="Change log"
            className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ClockIcon className="w-6 h-6" />
          </button>
        </Tooltip>
        <Tooltip label="Budget Log" placement="bottom">
          <button
            type="button"
            onClick={() => setBudgetLogOpen(true)}
            aria-label="Budget Log"
            className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ClipboardDocumentListIcon className="w-6 h-6" />
          </button>
        </Tooltip>
        {/* Set all dailies to Rec. — icon-only secondary, paired with Sync.
            Pacer sub-tab only (where the dailies table lives); lights up to
            the soft primary color on hover. */}
        {pacerTab === 'pacer' && !plan?.frozen && (
          <Tooltip label="Set all dailies to recommended" placement="bottom">
            <button
              type="button"
              onClick={bulkSetDailies}
              aria-label="Set all dailies to recommended"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]"
            >
              <BoltIcon className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        {/* Sync — icon-only secondary, sits to the left of Import. */}
        <Tooltip
          label={
            <span className="block">
              <span className="block">
                {plan?.frozen
                  ? 'Frozen — reopen to re-sync'
                  : 'Sync actual spend from Meta'}
              </span>
              {lastSyncedAt && (
                <span className="mt-0.5 block text-[var(--muted-foreground)]">
                  Last synced {fmtSyncedAgo(lastSyncedAt)}
                </span>
              )}
            </span>
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => handleSyncMeta()}
            disabled={syncingMeta || !!plan?.frozen}
            aria-label="Sync from Meta"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
        {/* Import — primary, white Meta badge. */}
        <Tooltip
          label={
            plan?.frozen
              ? 'This month is frozen — reopen it to import'
              : 'Bring existing Meta ad sets into this month as rows'
          }
          placement="bottom"
        >
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          disabled={!!plan?.frozen}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MetaBrandIcon className="w-3.5 h-3.5 brightness-0 invert" />
          Import from Meta
        </button>
        </Tooltip>
      </div>
    ) : null;

  const hasTabs = mode === 'pacer' || (mode === 'planner' && !!activeKey);

  // Carryover prompt (Change 7) — fold last month's settled over/under into
  // this month's spend target, opt-in, per bucket. Never touches the client
  // budget goal. Rendered up in the account scope row (planner only) so it
  // doesn't add a dedicated row above the budget cards.
  const carryoverNotice =
    activeKey && plan && !plan.frozen && mode === 'planner' && plannerTab === 'planner'
      ? (() => {
          const prior = plan.priorOverUnder;
          const appliedBase = num(plan.baseCarryover);
          const appliedAdded = num(plan.addedCarryover);
          const applied = appliedBase != null || appliedAdded != null;
          // Always surface an unapplied prior over/under so you can decide
          // whether to fold it in — even below the threshold. Only hide when
          // there's nothing meaningful to show.
          if (!applied && (!prior || Math.abs(prior.variance) < 0.005)) {
            return null;
          }
          const fromLabel = fmtPeriodShort(shiftPeriod(period, -1));
          if (applied) {
            const amt = appliedBase != null ? appliedBase : appliedAdded ?? 0;
            const bucket = appliedBase != null ? 'base' : 'added';
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ArrowPathIcon className="w-4 h-4 flex-shrink-0 text-[var(--primary)]" />
                  <span className="text-xs text-[var(--foreground)]">
                    Carryover applied:{' '}
                    <span className="font-semibold">
                      {amt >= 0 ? '+' : '−'}
                      {fmt(Math.abs(amt))}
                    </span>{' '}
                    to {bucket === 'base' ? 'Base' : 'Added'} (from {fromLabel}).
                    The client budget is unchanged.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyCarryover(bucket, true)}
                  disabled={applyingCarryover}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </div>
            );
          }
          const variance = prior!.variance;
          const under = variance < 0;
          const carry = prior!.carryover;
          const prominent = prior!.exceedsThreshold && !carryoverDismissed;
          if (!prominent) {
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2">
                <div className="flex items-center gap-2 min-w-0 text-xs text-[var(--muted-foreground)]">
                  <ScaleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">
                      {fromLabel}
                    </span>{' '}
                    {under ? 'underspent' : 'overspent'} by{' '}
                    <span className="font-semibold text-[var(--foreground)]">
                      {fmt(Math.abs(variance))}
                    </span>{' '}
                    vs target.
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={carryoverBucket}
                    onChange={(e) =>
                      setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                    }
                    className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                    aria-label="Carryover bucket"
                  >
                    <option value="base">Base</option>
                    <option value="added">Added</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleApplyCarryover(carryoverBucket, false)}
                    disabled={applyingCarryover}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {applyingCarryover
                      ? 'Applying…'
                      : `Apply ${carry >= 0 ? '+' : '−'}${fmt(Math.abs(carry))}`}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div
              className="flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-2.5"
              style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.06)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ScaleIcon className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.warn }} />
                <div className="min-w-0 text-xs text-[var(--foreground)]">
                  <span className="font-semibold">{fromLabel}</span>{' '}
                  {under ? 'underspent' : 'overspent'} by{' '}
                  <span className="font-semibold" style={{ color: under ? COLORS.warn : COLORS.error }}>
                    {fmt(Math.abs(variance))}
                  </span>{' '}
                  vs target — exceeds the {fmt(CARRYOVER_THRESHOLD)} threshold.
                  <span className="text-[var(--muted-foreground)]">
                    {' '}Apply{' '}
                    <span className="font-semibold text-[var(--foreground)]">
                      {carry >= 0 ? '+' : '−'}
                      {fmt(Math.abs(carry))}
                    </span>{' '}
                    to this month&apos;s spend target?
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={carryoverBucket}
                  onChange={(e) =>
                    setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                  }
                  className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                  aria-label="Carryover bucket"
                >
                  <option value="base">Base</option>
                  <option value="added">Added</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleApplyCarryover(carryoverBucket, false)}
                  disabled={applyingCarryover}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {applyingCarryover ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => setCarryoverDismissed(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  Leave as-is
                </button>
              </div>
            </div>
          );
        })()
      : null;

  return (
    <PacerReadOnlyContext.Provider value={!!plan?.frozen}>
    <div className="animate-fade-in-up">
      {/* Page header — title row + sub-tabs are pinned together inside one
          sticky element so the tabs don't scroll away. */}
      <div
        className={`page-sticky-header pad-on-scroll ${hasTabs ? 'has-tabs ' : ''}${
          mode === 'pacer' ? 'mb-8' : 'mb-6'
        }`}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Left: title */}
          <div className="flex items-center gap-3 min-w-0">
            <MetaBrandIcon className="w-8 h-8 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold">Meta Ads</h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                {mode === 'planner'
                  ? 'Plan and allocate your monthly Meta ad budgets'
                  : 'Track spend pacing across the active period'}
              </p>
            </div>
          </div>

          {/* Center: Plan / Pace mode switch — consolidates the former Ad
              Planner + Ad Pacer pages. Each mode keeps its own sub-tabs. */}
          <div className="flex justify-center">
            <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
              {(['planner', 'pacer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === m
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {m === 'planner' ? 'Plan' : 'Pace'}
                </button>
              ))}
            </div>
          </div>

          {/* Right: notes + month + filters */}
          <div className="flex items-center justify-end gap-3 flex-wrap">
            {activeKey && (
              <AccountNotesButton
                count={notesCount}
                onClick={() => setNotesOpen(true)}
                ariaLabel={`Open notes for ${activeAccount?.dealer ?? activeKey}`}
              />
            )}
            <PeriodSelector period={period} onChange={setPeriod} />
            <button
              type="button"
              onClick={() => setFilterSidebarOpen((o) => !o)}
              aria-pressed={filterSidebarOpen}
              aria-expanded={filterSidebarOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                filterSidebarOpen
                  ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary)]'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              <FunnelIcon className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount(filters) > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--primary)', color: 'white' }}
                >
                  {activeFilterCount(filters)}
                </span>
              )}
            </button>
          </div>
        </div>

      {/* Sub-tabs — pinned inside the sticky header so they don't scroll away. */}
      {mode === 'pacer' && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {activeKey && (
            <>
              <button
                type="button"
                onClick={() => setPacerTab('summary')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'summary'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <TableCellsIcon className="w-3.5 h-3.5" />
                Summary
              </button>
              <button
                type="button"
                onClick={() => setPacerTab('pacer')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'pacer'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                Pacer
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setPacerTab('compare')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              pacerTab === 'compare'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ScaleIcon className="w-3.5 h-3.5" />
            Over/Under Spend
          </button>
        </div>
      )}

      {/* Planner sub-tabs — Planner + Reconciliation, mirroring the Pacer
          page's tab row. Only shown when an account is selected, since the
          Reconciliation view needs an account. */}
      {mode === 'planner' && activeKey && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => setPlannerTab('planner')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'planner'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
            Planner
          </button>
          <button
            type="button"
            onClick={() => setPlannerTab('reconcile')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'reconcile'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <InvestmentIcon className="w-3.5 h-3.5" />
            Reconciliation
          </button>
        </div>
      )}
      </div>

      {/* Scope row — avatar + account name + status battery on the left;
          pacer actions on the right. The carryover banner renders full-width
          directly below (planner), so the row hugs it when present. */}
      <div
        className={`flex items-start justify-between gap-4 flex-wrap ${
          carryoverNotice ? 'mb-4' : 'mb-10'
        }`}
      >
        {activeKey ? (
          <div className="flex items-center gap-3 min-w-0">
            <AccountAvatar
              name={activeAccount?.dealer ?? activeKey}
              accountKey={activeKey}
              storefrontImage={activeAccount?.storefrontImage}
              logos={activeAccount?.logos}
              size={56}
              className="rounded-xl border border-[var(--border)] bg-[var(--muted)] flex-shrink-0"
            />
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-2xl font-bold text-[var(--foreground)] leading-tight">
                {activeAccount?.dealer || activeKey || '—'}
              </span>
              {plan && plan.ads.length > 0 && <StatusBattery ads={plan.ads} />}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-sm text-[var(--muted-foreground)]">
              All accounts overview
            </span>
          </div>
        )}

        {/* Pacer scope-row right side: the Pacer sub-tab shows the spend
            metrics here (its action buttons moved into the "Spend Pacing"
            header). The other Pacer sub-tabs keep the action buttons here. */}
        {mode === 'pacer' &&
          activeKey &&
          (pacerTab === 'pacer' ? (
            <PacerSpendTotals
              base={totals.base}
              added={totals.added}
              actual={totals.actual}
              pacing={pacerAccountPacing}
            />
          ) : (
            pacerActions
          ))}
      </div>

      {/* Carryover prompt — full-width row directly under the account scope
          (planner only, when present) so its text never wraps. */}
      {carryoverNotice && <div className="mb-6">{carryoverNotice}</div>}

      {/* Frozen-month banner (Change 5). A closed month is a read-only,
          immutable snapshot of what was actually managed; admins can reopen
          it to correct, which keeps the original snapshot as the record. */}
      {activeKey && plan?.frozen && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3"
          style={{ borderColor: COLORS.warn, background: 'rgba(245,158,11,0.08)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <LockClosedIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} is frozen — closed month
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Read-only snapshot of what was managed
                {plan.frozenAt ? ` · frozen ${fmtSyncedAgo(plan.frozenAt)}` : ''}.
                Editing and Meta sync are disabled.
              </div>
            </div>
          </div>
          <Tooltip label="Reopen this month for corrections (admin). The original snapshot is kept.">
          <button
            type="button"
            onClick={handleReopenMonth}
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon
              className={`w-3.5 h-3.5 ${reopening ? 'animate-spin' : ''}`}
            />
            {reopening ? 'Reopening…' : 'Reopen month'}
          </button>
          </Tooltip>
        </div>
      )}

      {/* Reopened closed month — editable for correction; prompt to re-freeze
          when done so it relocks as a faithful record. */}
      {activeKey && plan?.reopened && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <ExclamationTriangleIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} reopened — closed month, editing enabled
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Changes save normally. Re-freeze when finished to lock it back as
                the record of what happened.
              </div>
            </div>
          </div>
          <Tooltip label="Re-freeze this month, locking it read-only again">
          <button
            type="button"
            onClick={handleRefreezeMonth}
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LockClosedIcon className="w-3.5 h-3.5" />
            {reopening ? 'Working…' : 'Re-freeze month'}
          </button>
          </Tooltip>
        </div>
      )}

      {/* Body — budget header + content + inline filter sidebar all share
          the same 2-col grid so the header rows shrink alongside the body
          when the filter panel opens. Layout applies on both the
          per-account view and the admin overview. */}
      <div
        className={
          filterSidebarOpen
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start'
            : ''
        }
      >
        <div className="min-w-0">
          {/* Budget header (Total + Base/Added) — only on the Planner tab */}
          {activeKey && plan && mode === 'planner' && plannerTab === 'planner' && (
            <div className="mb-10 space-y-5">
              <TotalAllocationHeader plan={plan} />
              <div className="flex items-start gap-5 flex-wrap">
                <BudgetPanel
                  title="Base Budget"
                  source="base"
                  color={COLORS.base}
                  goalKey="baseBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
                <BudgetPanel
                  title="Added Budget"
                  source="added"
                  color={COLORS.added}
                  goalKey="addedBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
              </div>
            </div>
          )}

          {!activeKey ? (
            mode === 'pacer' && pacerTab === 'compare' ? (
              <div className="glass-section-card rounded-xl px-7 py-7">
                <ComparePanel accountKey={null} period={period} />
              </div>
            ) : (
              <OverviewView
                period={period}
                filters={filters}
                currentUserId={currentUserId}
                onOpenAccount={(key) =>
                  setAccount({ mode: 'account', accountKey: key })
                }
                users={users}
                accounts={overviewAccounts}
                loadError={overviewError}
              />
            )
          ) : !loaded ? (
            <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
              Loading saved data…
            </div>
          ) : loadError ? (
            <div className="glass-section-card rounded-xl text-center py-16 px-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-[var(--foreground)] text-sm font-medium mb-1">
                Could not load this account&apos;s planner data.
              </p>
              <p className="text-[var(--muted-foreground)] text-xs mb-1">{loadError}</p>
              <p className="text-[var(--muted-foreground)] text-xs">
                If you just deployed the new schema, restart the dev server so the Prisma
                client picks up the new models, then refresh.
              </p>
            </div>
          ) : !plan ? null : (() => {
            // Ad Planner + Pacer's Summary tab render flush (no outer card)
            // so the inner table reads as the page-level content. Pacer's
            // Pacer + Over/Under Spend tabs keep the glass-section-card
            // chrome since their content benefits from the visual frame.
            const flat =
              (mode === 'planner' && plannerTab === 'planner') ||
              (mode === 'pacer' && (pacerTab === 'summary' || pacerTab === 'pacer'));
            const wrapperClass = flat
              ? ''
              : 'glass-section-card rounded-xl px-7 py-7';
            const inner =
              mode === 'planner' ? (
                plannerTab === 'reconcile' ? (
                  <ReconciliationPanel accountKey={activeKey} />
                ) : (
                  <AdPlannerPanel
                    plan={plan}
                    period={period}
                    users={users}
                    filters={filters}
                    onFiltersChange={setFilters}
                    currentUserId={currentUserId}
                    periodSummaries={periodSummaries}
                    onChange={setPlan}
                    onCopyFrom={handleCopyFrom}
                    onImport={plan?.frozen ? undefined : () => setImportOpen(true)}
                    onModalOpenChange={setEditorOpen}
                    onAddActivity={onAddActivity}
                    onEditActivity={onEditActivity}
                    onDeleteActivity={onDeleteActivity}
                  />
                )
              ) : pacerTab === 'pacer' ? (
                <BudgetPacerPanel
                  plan={plan}
                  filters={filters}
                  onFiltersChange={setFilters}
                  currentUserId={currentUserId}
                  onChange={setPlan}
                  accountKey={activeKey}
                  headerActions={pacerActions}
                />
              ) : pacerTab === 'compare' ? (
                <ComparePanel accountKey={activeKey} period={period} />
              ) : (
                <SummaryPanel plan={plan} />
              );
            return flat ? inner : <div className={wrapperClass}>{inner}</div>;
          })()}
        </div>

        {/* Inline filter sidebar — renders on both per-account view
            (ads pulled from `plan.ads`) and the admin overview (ads
            flattened from `overviewAccounts`). The slide-in/out
            animation comes from the className transitions. */}
        <MetaAdsPacerFilterSidebar
          open={filterSidebarOpen}
          inline
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          onChange={setFilters}
          users={users}
          ads={activeKey ? plan?.ads ?? [] : overviewAds}
          currentUserId={currentUserId}
          className={`glass-section-card pacer-ad-card w-full transition-[opacity,transform,max-height] duration-300 ease-out lg:sticky lg:top-24 lg:w-[360px] ${
            filterSidebarOpen
              ? 'pointer-events-auto max-h-[calc(100vh-8rem)] translate-x-0 opacity-100 animate-slide-in-right'
              : 'pointer-events-none max-h-0 translate-x-4 opacity-0 hidden'
          }`}
        />
      </div>

      {/* Account-level notes modal — opened from the chat icon next to
          the period selector (subaccount view) or the chat icon on
          each account row (admin overview). */}
      {notesOpen && activeKey && (
        <AccountNotesDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setNotesOpen(false)}
          onCountChange={setNotesCount}
        />
      )}
      {/* Budget Log + Change Log drawers — lifted here so the scope-row icon
          buttons work across every pacer sub-tab. */}
      {budgetLogOpen && activeKey && plan && (
        <BudgetLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          adsSnapshot={adsSnapshot}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setBudgetLogOpen(false)}
        />
      )}
      {changeLogOpen && activeKey && (
        <ChangeLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          onClose={() => setChangeLogOpen(false)}
        />
      )}
      {importOpen && activeKey && (
        <ImportFromMetaModal
          accountKey={activeKey}
          period={period}
          periodLabel={fmtPeriodLong(period)}
          users={users}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
    </PacerReadOnlyContext.Provider>
  );
}

// (Page-level entrypoints live at /tools/meta/ad-planner and /tools/meta/ad-pacer
// and import this component as `MetaAdsPlannerTool` with the appropriate `mode`.)
