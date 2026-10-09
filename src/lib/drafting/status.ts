/**
 * Where a DraftRequest is in the pipeline (docs/email-drafting.md §4).
 *
 * Stored as a plain string column, so this list is the vocabulary.
 */

export const DRAFT_STATUSES = [
  /** monday's Client label doesn't name exactly one Loomi account; nothing is drafted until it does. */
  'needs_account',
  /** Started; waiting for the worker. */
  'queued',
  /** Reading monday and copying the approved creative into Loomi. */
  'fetching',
  /** The creative is in Loomi; nothing has read it yet. */
  'awaiting_extraction',
  'extracting',
  /** A person checks what was read off the creative, disclaimer first. */
  'awaiting_confirmation',
  /** The creative and the written request disagree. A person decides; Loomi never picks. */
  'conflict',
  'drafting',
  /** A hard rule failed. The version says which; nothing went to monday. */
  'blocked',
  /** The PNG and HTML are in Draft Files, ready for someone to start a proof. */
  'in_proofing',
  /** PageProof came back "To-dos requested". */
  'changes_requested',
  /** PageProof came back "Approved". The uploaded version is final. */
  'approved',
  /** Something broke; `error` says what. */
  'failed',
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export function isDraftStatus(value: string): value is DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value);
}

/** The worker owns the request right now — starting it again would race. */
export const RUNNING_STATUSES: readonly DraftStatus[] = ['queued', 'fetching', 'extracting', 'drafting'];

export function isRunning(status: string): boolean {
  return (RUNNING_STATUSES as readonly string[]).includes(status);
}

/** Proof is out, so the PageProof outcome is worth reading. */
export const PROOFING_STATUSES: readonly DraftStatus[] = ['in_proofing', 'changes_requested'];
