// Run an async job at most once at a time within this process.
//
// pg-boss abandons a handler that outlives its job's expiry and fetches the
// next job — but the abandoned handler's work keeps running. For a recurring
// sweep that means two copies of the same work in flight. Wrapping the sweep
// in this makes the overlapping tick a no-op instead.
//
// Process-local by design: the worker runs as a single pm2 process.

export interface SingleFlight {
  (): Promise<void>;
  /** Resolves once the run in progress (if any) has settled. */
  whenIdle(): Promise<void>;
}

export function singleFlight(
  job: () => Promise<void>,
  onSkip?: () => void,
): SingleFlight {
  let current: Promise<void> | null = null;

  const run = (async () => {
    if (current) {
      onSkip?.();
      return;
    }
    current = job();
    try {
      await current;
    } finally {
      current = null;
    }
  }) as SingleFlight;

  run.whenIdle = async () => {
    // Settled either way; a failed run is still a finished one.
    await current?.catch(() => undefined);
  };

  return run;
}
