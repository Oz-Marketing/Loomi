import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAmbiguousScheduleFailure, submitSchedule, waitForScheduleCommit } from './schedule-submit';

const noSleep = () => Promise.resolve();

describe('isAmbiguousScheduleFailure', () => {
  it('treats a dropped connection and gateway errors as "unknown", not "refused"', () => {
    expect(isAmbiguousScheduleFailure(null)).toBe(true);
    expect(isAmbiguousScheduleFailure(502)).toBe(true);
    expect(isAmbiguousScheduleFailure(503)).toBe(true);
    expect(isAmbiguousScheduleFailure(504)).toBe(true);
    for (const status of [400, 403, 409, 422, 500]) {
      expect(isAmbiguousScheduleFailure(status)).toBe(false);
    }
  });
});

describe('waitForScheduleCommit', () => {
  it('returns true once the blast leaves draft', async () => {
    const statuses = ['draft', 'draft', 'scheduled'];
    const read = vi.fn(async () => statuses.shift() ?? 'draft');
    expect(await waitForScheduleCommit(read, { attempts: 5, sleep: noSleep })).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('gives up after its attempts, counting failed reads as "not yet"', async () => {
    const read = vi.fn(async () => null);
    expect(await waitForScheduleCommit(read, { attempts: 3, sleep: noSleep })).toBe(false);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('submitSchedule', () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('passes a success straight through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { campaign: { status: 'scheduled' } })));
    const out = await submitSchedule({ scheduleUrl: '/s', blastUrl: '/b', body: {} });
    expect(out).toMatchObject({ ok: true, confirmedLate: false });
  });

  it('reports a real refusal with the server’s message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { error: 'Add a postal address.' })));
    const out = await submitSchedule({ scheduleUrl: '/s', blastUrl: '/b', body: {} });
    expect(out).toMatchObject({ ok: false, status: 422, error: 'Add a postal address.' });
  });

  // nginx answers 504 at 60s while the server keeps committing a large audience.
  it('treats a 504 as scheduled when the blast turns out to have left draft', async () => {
    const onWaiting = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/s' ? new Response('Gateway Timeout', { status: 504 }) : json(200, { campaign: { status: 'scheduled' } }),
      ),
    );
    const out = await submitSchedule({ scheduleUrl: '/s', blastUrl: '/b', body: {}, onWaiting });
    expect(out).toMatchObject({ ok: true, confirmedLate: true });
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  it('treats a dropped connection the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/s') throw new TypeError('Failed to fetch');
        return json(200, { campaign: { status: 'queued' } });
      }),
    );
    const out = await submitSchedule({ scheduleUrl: '/s', blastUrl: '/b', body: {} });
    expect(out).toMatchObject({ ok: true, confirmedLate: true });
  });
});
