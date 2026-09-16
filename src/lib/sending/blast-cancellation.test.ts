import { describe, expect, it, vi } from 'vitest';
import { createCancelGate } from './blast-cancellation';

describe('createCancelGate', () => {
  it('queries at most once per TTL window', async () => {
    let clock = 0;
    const probe = vi.fn(async () => false);
    const gate = createCancelGate(probe, {
      ttlMs: 1000,
      maxCalls: 1000,
      now: () => clock,
    });

    expect(await gate()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);

    // Inside the window — cached.
    clock = 999;
    expect(await gate()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);

    // Window elapsed — asks again.
    clock = 1000;
    expect(await gate()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('re-checks after maxCalls even inside the TTL window', async () => {
    // A fast send would otherwise push its whole audience through one cached
    // answer — the bound someone cancelling actually cares about is how many
    // MORE messages went out, not how many seconds passed.
    const probe = vi.fn(async () => false);
    const gate = createCancelGate(probe, {
      ttlMs: 60_000,
      maxCalls: 5,
      now: () => 0,
    });

    for (let i = 0; i < 5; i += 1) await gate();
    expect(probe).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) await gate();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('latches once canceled and stops querying', async () => {
    let clock = 0;
    const probe = vi.fn(async () => true);
    const gate = createCancelGate(probe, {
      ttlMs: 1000,
      maxCalls: 5,
      now: () => clock,
    });

    expect(await gate()).toBe(true);
    clock = 10_000;
    expect(await gate()).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight query across concurrent callers', async () => {
    let release: (value: boolean) => void = () => {};
    const probe = vi.fn(
      () => new Promise<boolean>((resolve) => { release = resolve; }),
    );
    const gate = createCancelGate(probe, {
      ttlMs: 1000,
      maxCalls: 1,
      now: () => 0,
    });

    // The send loop runs several tasks at once; they must not each fire
    // their own status query.
    const pending = [gate(), gate(), gate()];
    expect(probe).toHaveBeenCalledTimes(1);

    release(true);
    expect(await Promise.all(pending)).toEqual([true, true, true]);
  });

  it('treats a failed check as "not canceled" so a send is never aborted by a database blip', async () => {
    let clock = 0;
    const probe = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const gate = createCancelGate(probe, {
      ttlMs: 1000,
      maxCalls: 1000,
      now: () => clock,
    });

    expect(await gate()).toBe(false);
    // And it recovers: the failure isn't latched either.
    clock = 2000;
    expect(await gate()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
