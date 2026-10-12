// Which Blasts-list rows an action may touch, and how a rename reaches both
// halves of an email + text pair.
//
// Bulk Archive used to send every selected row to the server. The row menu
// already hid Archive for a blast with a send still ahead of it; the bulk dock
// didn't, so a scheduled blast could be archived — hidden from the list — and
// then go out anyway, with nothing left on screen to stop it. Both paths now
// ask isInFlightBlastStatus.

/**
 * A send is still ahead of this blast: queued, scheduled, or sending (which
 * includes one held by a warm-up cap or a text's quiet hours). Archive and
 * Delete refuse these; Cancel is for them. The fuzzy terms match the list's
 * status normalization, which folds provider variants ("active", "running")
 * into "scheduled".
 */
export function isInFlightBlastStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'queued' || s === 'scheduled' || s === 'processing') return true;
  return ['active', 'sched', 'queue', 'start', 'running', 'progress'].some((t) => s.includes(t));
}

/**
 * Why a blast that should be sending isn't, when the send engine has paused
 * it — or null. A paused send keeps its scheduled/queued/processing status
 * (it resumes once the cause is fixed) and records the reason in `error` as
 * "Paused: …" — a provider outage, a rejected API key, a send-time preflight
 * blocker. Without surfacing it, the list just showed "Scheduled" for a blast
 * whose time had come and gone.
 */
export function pausedSendReason(
  status: string | null | undefined,
  error: string | null | undefined,
): string | null {
  if (!isInFlightBlastStatus(status)) return null;
  const text = String(error || '').trim();
  if (!/^paused:/i.test(text)) return null;
  return text.replace(/^paused:\s*/i, '').trim() || 'Sending is paused.';
}

export interface BulkRow {
  provider?: string | null;
  status: string;
  isFlow?: boolean;
}

/** Rows split by whether a bulk Archive/Delete may act on them. */
export interface BulkPartition<R> {
  actionable: R[];
  /** Still sending or waiting to send — cancel first. */
  inFlight: R[];
  /** Not Loomi's to change: imported rows and flow steps. */
  unmanaged: R[];
}

export function partitionBulkTargets<R extends BulkRow>(rows: R[]): BulkPartition<R> {
  const out: BulkPartition<R> = { actionable: [], inFlight: [], unmanaged: [] };
  for (const row of rows) {
    const provider = String(row.provider || '').toLowerCase();
    const isLoomi = provider === 'loomi-email' || provider === 'loomi-sms';
    if (!isLoomi || row.isFlow) out.unmanaged.push(row);
    else if (isInFlightBlastStatus(row.status)) out.inFlight.push(row);
    else out.actionable.push(row);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The "what was skipped" sentences for a bulk action's summary. */
export function bulkSkipSummary(part: { inFlight: unknown[]; unmanaged: unknown[] }): string[] {
  const lines: string[] = [];
  if (part.inFlight.length > 0) {
    lines.push(
      `${plural(part.inFlight.length, 'blast')} skipped because ${
        part.inFlight.length === 1 ? 'it is' : 'they are'
      } scheduled or sending — cancel ${part.inFlight.length === 1 ? 'it' : 'them'} first.`,
    );
  }
  if (part.unmanaged.length > 0) {
    lines.push(`${plural(part.unmanaged.length, 'row')} skipped (managed outside Loomi or by a flow).`);
  }
  return lines;
}

export type RenameChannel = 'email' | 'sms' | 'multi';

export interface RenameResult {
  /** Set when the text half of a pair kept its old name. */
  partnerError?: string;
}

async function patchName(path: string, id: string, name: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/blasts/${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' && data.error ? data.error : `HTTP ${res.status}`);
  }
  return data;
}

/** The other half's id, read off the PATCH response of the half just renamed. */
function linkedIdFrom(
  data: Record<string, unknown>,
  key: 'linkedSmsBlastId' | 'linkedEmailBlastId',
): string | null {
  const campaign = data.campaign as { metadata?: unknown } | undefined;
  if (typeof campaign?.metadata !== 'string') return null;
  try {
    const meta = JSON.parse(campaign.metadata) as Record<string, unknown>;
    const id = meta?.[key];
    return meta?.multiChannel === true && typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Rename a blast — both halves when it is one side of an email + text pair.
 *
 * A pair is two rows the list shows as one (anchored on the email half), and
 * the server does not cascade names. Renaming only the half that was clicked
 * left the other carrying the old name wherever it surfaces. The partner is
 * found from whichever half was renamed, so this holds whatever page started
 * it. Throws if the named half fails; a partner that fails comes back in
 * `partnerError`, since the name the user sees did change.
 */
export async function renameBlast(
  channel: RenameChannel,
  id: string,
  name: string,
): Promise<RenameResult> {
  const own = channel === 'sms' ? 'sms' : 'email';
  const data = await patchName(own, id, name);
  const partnerId =
    own === 'email'
      ? linkedIdFrom(data, 'linkedSmsBlastId')
      : linkedIdFrom(data, 'linkedEmailBlastId');
  if (!partnerId) return {};
  try {
    await patchName(own === 'email' ? 'sms' : 'email', partnerId, name);
    return {};
  } catch (err) {
    const half = own === 'email' ? 'text' : 'email';
    return {
      partnerError: `The linked ${half} kept its old name: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }
}
