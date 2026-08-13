import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The heartbeat is what these cover.
 *
 * The sweep shipped without one, which meant "no licences expired today" and
 * "this job died three weeks ago" produced identical evidence: nothing. Every
 * test here is about a row existing, because that absence is the failure mode.
 */

const sweepRuns: Record<string, unknown>[] = [];
let assetRows: Record<string, unknown>[] = [];
let findManyThrows = false;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(async () => {
        if (findManyThrows) throw new Error('relation "MediaAsset" does not exist');
        return assetRows;
      }),
      update: vi.fn(async () => ({})),
    },
    mediaSweepRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sweepRuns.push(data);
        return { id: `run-${sweepRuns.length}` };
      }),
    },
    account: { findUnique: vi.fn(async () => ({ accountRepId: null })) },
    user: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/notifications/service', () => ({
  createNotification: vi.fn(async () => ({})),
}));

const NOW = new Date('2026-08-12T09:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  sweepRuns.length = 0;
  assetRows = [];
  findManyThrows = false;
});

describe('sweepMediaExpiration heartbeat', () => {
  it('records a run even when nothing was due', async () => {
    // The case the original code left invisible.
    const { sweepMediaExpiration } = await import('./media-expiration');
    const r = await sweepMediaExpiration(undefined, NOW);

    expect(sweepRuns).toHaveLength(1);
    expect(sweepRuns[0]).toMatchObject({ scanned: 0, expiredCount: 0, warnedCount: 0, error: null });
    expect(r.runId).toBe('run-1');
  });

  it('records counts of what it actually did', async () => {
    assetRows = [
      {
        id: 'a1',
        accountKey: 'youngHondaOgden',
        oem: 'Honda',
        filename: 'lapsed.jpg',
        licenseExpiresAt: inDays(-3),
        expiresAt: null,
        expiredAt: null,
        expirationReason: null,
        expirationWarnedAt: null,
      },
      {
        id: 'a2',
        accountKey: 'youngHondaOgden',
        oem: 'Honda',
        filename: 'soon.jpg',
        licenseExpiresAt: inDays(5),
        expiresAt: null,
        expiredAt: null,
        expirationReason: null,
        expirationWarnedAt: null,
      },
    ];

    const { sweepMediaExpiration } = await import('./media-expiration');
    await sweepMediaExpiration(undefined, NOW);

    expect(sweepRuns[0]).toMatchObject({ scanned: 2, expiredCount: 1, warnedCount: 1 });
  });

  it('records the detail so a pull is explicable afterwards', async () => {
    assetRows = [
      {
        id: 'a1',
        accountKey: null,
        oem: 'Audi',
        filename: 'shared-hero.jpg',
        licenseExpiresAt: inDays(-1),
        expiresAt: null,
        expiredAt: null,
        expirationReason: null,
        expirationWarnedAt: null,
      },
    ];

    const { sweepMediaExpiration } = await import('./media-expiration');
    await sweepMediaExpiration(undefined, NOW);

    const detail = JSON.parse(String(sweepRuns[0].detail));
    expect(detail.expired[0]).toMatchObject({ filename: 'shared-hero.jpg', reason: 'license' });
  });

  it('records a run WITH the error when the lookup fails', async () => {
    // An unmigrated environment used to return silently. A failed sweep and a
    // quiet one must not look the same.
    findManyThrows = true;

    const { sweepMediaExpiration } = await import('./media-expiration');
    const r = await sweepMediaExpiration(undefined, NOW);

    expect(sweepRuns).toHaveLength(1);
    expect(String(sweepRuns[0].error)).toContain('does not exist');
    expect(r.expired).toEqual([]);
    expect(r.runId).toBe('run-1');
  });

  it('tags an on-demand run with its account and a scheduled run with null', async () => {
    const { sweepMediaExpiration } = await import('./media-expiration');

    await sweepMediaExpiration('youngHondaOgden', NOW);
    expect(sweepRuns[0]).toMatchObject({ accountKey: 'youngHondaOgden' });

    await sweepMediaExpiration(undefined, NOW);
    expect(sweepRuns[1]).toMatchObject({ accountKey: null });
  });

  it('reports runId null rather than throwing when the row cannot be written', async () => {
    // Losing the heartbeat must not take the worker down with it.
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.mediaSweepRun.create).mockRejectedValueOnce(new Error('db down'));

    const { sweepMediaExpiration } = await import('./media-expiration');
    const r = await sweepMediaExpiration(undefined, NOW);

    expect(r.runId).toBeNull();
  });
});
