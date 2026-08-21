import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The pre-sync's budget is the reason the daily alerts run at all.
 *
 * It's the only network-bound phase in the scan handler, and the handler
 * answers one HTTP request behind a 60s gateway. Unbounded, it spent the whole
 * window walking every linked account and the alert passes after it never
 * executed — production returned 504 four days running and nobody was told
 * about a single over-pacing account.
 *
 * So these pin the two properties that keep that from recurring: it stops on
 * time, and the accounts it didn't reach are the ones it takes first next run.
 */

const findMany = vi.fn();
const update = vi.fn();
const syncPeriodFromMeta = vi.fn();
const reconcileCompletedRuns = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    metaAdsPacerPlan: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

vi.mock('@/lib/integrations/meta-ads', () => ({
  isMetaConfigured: () => true,
  syncPeriodFromMeta: (...a: unknown[]) => syncPeriodFromMeta(...a),
}));

vi.mock('@/lib/meta-ads-pacer', () => ({
  accountTimeZone: async () => 'America/Denver',
  isPeriodWritable: async () => true,
  reconcileCompletedRuns: (...a: unknown[]) => reconcileCompletedRuns(...a),
}));

vi.mock('@/lib/timezone', () => ({
  zonedTodayIso: () => '2026-08-21',
}));

const plans = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `plan-${i}`,
    accountKey: `acct-${i}`,
    alertPreSyncAt: null,
    account: { metaAdAccountId: `act_${i}` },
  }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.META_PACER_ALERT_PRESYNC;
  process.env.META_PACER_ALERT_PRESYNC_BUDGET_MS = '1000';
});

describe('alert pre-sync', () => {
  it('stops at the budget and reports what it did not reach', async () => {
    const { refreshLinkedAccountsForAlerts } = await import('./refresh');
    findMany.mockResolvedValue(plans(50));
    // Each account costs ~120ms, so a 1s budget can't cover 50 of them.
    syncPeriodFromMeta.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ matched: 1 }), 120)),
    );

    const res = await refreshLinkedAccountsForAlerts();

    expect(res.deferred).toBeGreaterThan(0);
    expect(res.accountsSynced).toBeGreaterThan(0);
    expect(res.accountsSynced).toBeLessThan(50);
    // The whole point: it returns instead of running until the gateway kills it.
    expect(res.elapsedMs).toBeLessThan(3000);
    expect(res.accountsSynced + res.skipped + res.deferred).toBe(50);
  });

  it('asks for the stalest accounts first, nulls before any timestamp', async () => {
    const { refreshLinkedAccountsForAlerts } = await import('./refresh');
    findMany.mockResolvedValue([]);
    await refreshLinkedAccountsForAlerts();

    // Ordering is what stops a fixed slice starving the tail forever.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ alertPreSyncAt: { sort: 'asc', nulls: 'first' } }],
      }),
    );
  });

  it('stamps an account only after a real attempt', async () => {
    const { refreshLinkedAccountsForAlerts } = await import('./refresh');
    findMany.mockResolvedValue(plans(1));
    syncPeriodFromMeta.mockResolvedValue({ matched: 1 });

    await refreshLinkedAccountsForAlerts();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'plan-0' } }),
    );
  });

  it('leaves a failed account unstamped so it retries tomorrow', async () => {
    // Otherwise a persistently failing account would be sent to the back of the
    // rotation on every run and quietly stop being attempted.
    const { refreshLinkedAccountsForAlerts } = await import('./refresh');
    findMany.mockResolvedValue(plans(1));
    syncPeriodFromMeta.mockRejectedValue(new Error('rate limited'));

    const res = await refreshLinkedAccountsForAlerts();

    expect(res.errors).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing at all when the kill switch is off', async () => {
    // The switch is the zero-deploy escape hatch if Meta rate limits tighten.
    process.env.META_PACER_ALERT_PRESYNC = 'off';
    const { refreshLinkedAccountsForAlerts } = await import('./refresh');

    const res = await refreshLinkedAccountsForAlerts();

    expect(findMany).not.toHaveBeenCalled();
    expect(res.accountsSynced).toBe(0);
  });
});
