import { describe, expect, it, vi } from 'vitest';
import { singleFlight } from './single-flight';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('skips a tick that arrives while the previous run is still going', async () => {
    const gate = deferred();
    const job = vi.fn(() => gate.promise);
    const onSkip = vi.fn();
    const run = singleFlight(job, onSkip);

    const first = run();
    await run(); // overlapping tick: must not start a second copy
    expect(job).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    await run(); // the previous run finished, so this one goes ahead
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when the job throws', async () => {
    const job = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const run = singleFlight(job);

    await expect(run()).rejects.toThrow('boom');
    await run();
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('reports when the run in progress has settled', async () => {
    const gate = deferred();
    const run = singleFlight(() => gate.promise);
    const first = run();
    let idle = false;
    const waiting = run.whenIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    gate.resolve();
    await first;
    await waiting;
    expect(idle).toBe(true);
    // Nothing running: resolves straight away.
    await run.whenIdle();
  });
});
