// Submitting a blast's schedule when the answer may not come back.
//
// Scheduling a large audience writes every recipient row inside one
// transaction, which the server allows two minutes. nginx in front of it gives
// up on the request after 60 seconds and answers 504 (or 502 if the upstream
// connection drops) — while the server carries on and commits. Reporting that
// 504 as a failure told the user an already-scheduled blast hadn't been
// scheduled, and a second click then hit "already scheduled" or, worse,
// prompted someone to rebuild and send it again.
//
// So an answer that only means "the proxy stopped waiting" is never taken as
// a verdict: the blast itself is re-read, and if it has left draft the
// schedule went through.

export type ScheduleOutcome =
  /** Scheduled. `confirmedLate` when we only know because the blast moved on. */
  | { ok: true; confirmedLate: boolean; data: Record<string, unknown> }
  /** Refused, or still a draft once we stopped checking. */
  | { ok: false; status: number | null; data: Record<string, unknown>; error: string };

/**
 * Did the request fail in a way that says nothing about the schedule itself?
 * null is a network error — the connection dropped before any response.
 */
export function isAmbiguousScheduleFailure(status: number | null): boolean {
  return status === null || status === 502 || status === 503 || status === 504;
}

/**
 * Poll `readStatus` until the blast is no longer a draft, or give up.
 *
 * The server keeps committing for up to a minute after nginx answers, so one
 * immediate re-read would usually still see a draft. `readStatus` returning
 * null (the read itself failed) just counts as "not yet".
 */
export async function waitForScheduleCommit(
  readStatus: () => Promise<string | null>,
  options: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 16;
  const intervalMs = options.intervalMs ?? 5_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(intervalMs);
    const status = await readStatus().catch(() => null);
    if (status && status !== 'draft') return true;
  }
  return false;
}

/** The status of the blast at `blastUrl` (`GET /api/blasts/.../[id]`). */
async function readBlastStatus(blastUrl: string): Promise<string | null> {
  const res = await fetch(blastUrl, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { campaign?: { status?: unknown } };
  return typeof data.campaign?.status === 'string' ? data.campaign.status : null;
}

/**
 * POST a schedule and work out whether it took.
 *
 * `blastUrl` is the blast whose status settles an ambiguous answer — the email
 * half for an email + text pair, which the pair's route commits in the same
 * transaction as the text. `onWaiting` fires once if we have to wait, so the
 * page can say it's still checking instead of looking frozen.
 */
export async function submitSchedule(input: {
  scheduleUrl: string;
  blastUrl: string;
  body: Record<string, unknown>;
  onWaiting?: () => void;
}): Promise<ScheduleOutcome> {
  let status: number | null = null;
  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(input.scheduleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.body),
    });
    status = res.status;
    data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, confirmedLate: false, data };
  } catch {
    status = null;
  }

  if (isAmbiguousScheduleFailure(status)) {
    input.onWaiting?.();
    const committed = await waitForScheduleCommit(() => readBlastStatus(input.blastUrl));
    if (committed) return { ok: true, confirmedLate: true, data };
    return {
      ok: false,
      status,
      data,
      error:
        'We couldn’t confirm the schedule — the connection dropped before the server answered, and the blast is still a draft. Check the Blasts list, then try again.',
    };
  }

  const error =
    typeof data.error === 'string' && data.error ? data.error : 'Failed to schedule the blast.';
  return { ok: false, status, data, error };
}
