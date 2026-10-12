import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue, flushBuilderSaves, registerBuilderFlush } from './builder-autosave';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initialKey = 'a') {
  const state = { key: initialKey, ready: true };
  const saves: { key: string; done: ReturnType<typeof deferred> }[] = [];
  const queue = createSaveQueue({
    currentKey: () => state.key,
    ready: () => state.ready,
    save: (key) => {
      const done = deferred();
      saves.push({ key, done });
      return done.promise;
    },
  });
  return { state, saves, queue };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSaveQueue', () => {
  it('writes nothing for the state it was hydrated with', async () => {
    const { queue, saves } = setup('hydrated');
    queue.setSaved('hydrated');
    await queue.run(false);
    expect(saves).toHaveLength(0);
    expect(queue.dirty()).toBe(false);
  });

  it('writes nothing before hydration, even when the state differs', async () => {
    const { queue, saves, state } = setup('default');
    state.key = 'changed';
    await queue.run(false);
    expect(saves).toHaveLength(0);
  });

  it('saves a change and then considers it stored', async () => {
    const { queue, saves, state } = setup();
    queue.setSaved('a');
    state.key = 'b';
    expect(queue.dirty()).toBe(true);
    const run = queue.run(false);
    saves[0].done.resolve();
    await run;
    expect(saves.map((s) => s.key)).toEqual(['b']);
    expect(queue.savedKey()).toBe('b');
    expect(queue.dirty()).toBe(false);
  });

  // The ordering guarantee: an older save can't land after a newer one.
  it('waits for a save in flight before starting the next', async () => {
    const { queue, saves, state } = setup();
    queue.setSaved('a');
    state.key = 'b';
    const first = queue.run(false);
    state.key = 'c';
    const second = queue.run(true, 'c-confirmed');
    await tick();
    expect(saves.map((s) => s.key)).toEqual(['b']); // second hasn't started
    saves[0].done.resolve();
    await first;
    await tick();
    expect(saves.map((s) => s.key)).toEqual(['b', 'c-confirmed']);
    saves[1].done.resolve();
    await second;
    expect(queue.savedKey()).toBe('c-confirmed');
  });

  it('forces a save of an unchanged state when asked (an explicit Continue)', async () => {
    const { queue, saves } = setup('a');
    queue.setSaved('a');
    const run = queue.run(true);
    saves[0].done.resolve();
    await run;
    expect(saves.map((s) => s.key)).toEqual(['a']);
  });

  it('refuses a forced save while still loading instead of skipping it', async () => {
    const { queue, state } = setup();
    state.ready = false;
    await expect(queue.run(true)).rejects.toThrow(/still loading/);
  });

  it('keeps a failed change dirty so the next flush retries it', async () => {
    const { queue, saves, state } = setup();
    queue.setSaved('a');
    state.key = 'b';
    const run = queue.run(false);
    saves[0].done.reject(new Error('offline'));
    await expect(run).rejects.toThrow('offline');
    expect(queue.dirty()).toBe(true);
    expect(queue.busy()).toBe(false);
  });
});

describe('flushBuilderSaves', () => {
  const unregister: (() => void)[] = [];
  afterEach(() => unregister.splice(0).forEach((fn) => fn()));

  it('waits for every registered step', async () => {
    const order: string[] = [];
    unregister.push(registerBuilderFlush(async () => void order.push('recipients')));
    unregister.push(registerBuilderFlush(async () => void order.push('schedule')));
    await flushBuilderSaves();
    expect(order.sort()).toEqual(['recipients', 'schedule']);
  });

  it('rejects when a step could not save, so the header stays put', async () => {
    unregister.push(registerBuilderFlush(async () => {
      throw new Error('Failed to save recipients');
    }));
    await expect(flushBuilderSaves()).rejects.toThrow('Failed to save recipients');
  });

  it('forgets a step once it unregisters', async () => {
    const flush = vi.fn(async () => undefined);
    registerBuilderFlush(flush)();
    await flushBuilderSaves();
    expect(flush).not.toHaveBeenCalled();
  });
});
