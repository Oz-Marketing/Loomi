'use client';

// Save-as-you-go for the blast builder, and the hand-off that lets the header
// make a step finish saving before it navigates away.
//
// WHY THE HEADER HAS TO ASK. The progress nav and the exit arrow live in
// layout-shell, outside the step pages, and used to `router.push` straight
// away. The Recipients step only saved on its own Continue and Back buttons,
// so choosing an audience and then clicking "2 Message" in the header dropped
// the choice — and since a draft with no saved audience resolves to the whole
// account, the blast went to everyone. Each step now autosaves, and registers
// a flush here that the header awaits before it moves.

import { useCallback, useEffect, useRef } from 'react';

type Flush = () => Promise<void>;

const flushes = new Set<Flush>();

/** Register a step's flush for as long as it's mounted. Returns the unregister. */
export function registerBuilderFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/**
 * Finish every pending builder save. Rejects with the first failure, so the
 * caller can stay put instead of navigating away from unsaved work.
 */
export async function flushBuilderSaves(): Promise<void> {
  const results = await Promise.allSettled([...flushes].map((flush) => flush()));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error('Your latest changes could not be saved.');
  }
}

/** Fired after a step saves its draft, so the header can recheck its steps. */
export const BLAST_DRAFT_SAVED_EVENT = 'loomi:blast-draft-saved';

export function announceDraftSaved(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BLAST_DRAFT_SAVED_EVENT, { detail: { id } }));
}

// Browsers cap a keepalive request's body at 64 KB and reject anything larger
// outright. Keepalive only matters for a page that is unloading; for an
// in-app navigation an ordinary request finishes on its own.
const KEEPALIVE_LIMIT = 60_000;

/** PATCH a JSON body, with `keepalive` when it fits. Throws on failure. */
export async function patchJson(
  url: string,
  body: Record<string, unknown>,
  options: { keepalive?: boolean; fallbackError?: string } = {},
): Promise<Record<string, unknown>> {
  const json = JSON.stringify(body);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    keepalive: Boolean(options.keepalive) && json.length < KEEPALIVE_LIMIT,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' && data.error
        ? data.error
        : options.fallbackError || `Save failed (HTTP ${res.status}).`,
    );
  }
  return data;
}

export interface DraftAutosave {
  /** Save now if anything changed since the last save; resolves once saved. */
  flush: () => Promise<void>;
  /**
   * Save now even if nothing changed — an explicit "this is my choice".
   * Pass the key to save when it differs from the rendered state (a click
   * handler that has just set state can't wait for the re-render).
   */
  saveNow: (key?: string) => Promise<void>;
}

/**
 * Save a step's state shortly after it changes.
 *
 * - `key` is the state serialized exactly as it will be saved; `save` gets the
 *   key it is saving, so what is written is always what was compared. A
 *   different key from the last save means "dirty".
 * - Nothing is written until `ready` — the page has restored the draft — and
 *   the first key seen after that is taken as what's already stored. So the
 *   defaults a page renders before hydrating are never written over the draft.
 * - Saves are serialized: one in flight at a time, so an older save can never
 *   land after a newer one.
 * - Registered with the header's flush while mounted, and a change still
 *   pending when the page unmounts is sent then (keepalive, when it fits).
 * - `save` must throw on failure. A debounced save that fails goes to
 *   `onError`; a flush rejects, so a caller about to navigate can stay.
 */
export function useDraftAutosave({
  key,
  ready,
  save,
  onError,
  delayMs = 400,
}: {
  key: string;
  ready: boolean;
  save: (key: string, options: { keepalive: boolean }) => Promise<void>;
  onError?: (err: Error) => void;
  delayMs?: number;
}): DraftAutosave {
  const keyRef = useRef(key);
  keyRef.current = key;
  const saveRef = useRef(save);
  saveRef.current = save;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const queueRef = useRef<SaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = createSaveQueue({
      currentKey: () => keyRef.current,
      ready: () => readyRef.current,
      save: (k, options) => saveRef.current(k, options),
    });
  }
  const queue = queueRef.current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    return queue.run(false);
  }, [queue]);
  const saveNow = useCallback(
    (explicitKey?: string) => {
      clearTimeout(timer.current);
      return queue.run(true, explicitKey);
    },
    [queue],
  );

  useEffect(() => {
    if (!ready) return;
    if (queue.savedKey() === null) {
      queue.setSaved(key);
      return;
    }
    clearTimeout(timer.current);
    if (key === queue.savedKey()) return;
    timer.current = setTimeout(() => {
      queue.run(false).catch((err) => {
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, delayMs);
  }, [key, ready, delayMs, queue]);

  useEffect(() => registerBuilderFlush(flush), [flush]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (queue.dirty() && !queue.busy()) {
        void saveRef.current(keyRef.current, { keepalive: true }).catch(() => undefined);
      }
    },
    [queue],
  );

  return { flush, saveNow };
}

/** The ordering core of useDraftAutosave, free of React so it can be tested. */
export interface SaveQueue {
  /** Record `key` as what the draft already holds. */
  setSaved(key: string): void;
  savedKey(): string | null;
  /** Ready, hydrated, and holding a change that hasn't been saved. */
  dirty(): boolean;
  /** A save is on the wire. */
  busy(): boolean;
  /**
   * Save if forced or dirty. Waits for any save already in flight first, so
   * saves land in the order they were asked for. A forced save while not
   * ready rejects — an explicit save must never quietly not happen.
   */
  run(force: boolean, explicitKey?: string): Promise<void>;
}

export function createSaveQueue(deps: {
  currentKey: () => string;
  ready: () => boolean;
  save: (key: string, options: { keepalive: boolean }) => Promise<void>;
}): SaveQueue {
  let saved: string | null = null;
  let inFlight: Promise<void> | null = null;

  return {
    setSaved(key) {
      saved = key;
    },
    savedKey: () => saved,
    dirty: () => deps.ready() && saved !== null && deps.currentKey() !== saved,
    busy: () => inFlight !== null,
    async run(force, explicitKey) {
      while (inFlight) {
        await inFlight.catch(() => undefined);
      }
      if (!deps.ready()) {
        if (force) throw new Error('This step is still loading. Try again in a moment.');
        return;
      }
      const target = explicitKey ?? deps.currentKey();
      if (!force && (saved === null || target === saved)) return;
      // Claimed synchronously after the wait, so a second caller queued on the
      // same save sees this one and waits again.
      const attempt = deps.save(target, { keepalive: false }).then(() => {
        saved = target;
      });
      inFlight = attempt;
      try {
        await attempt;
      } finally {
        if (inFlight === attempt) inFlight = null;
      }
    },
  };
}
