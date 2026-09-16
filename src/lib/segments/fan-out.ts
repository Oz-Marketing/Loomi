// Creating one segment definition across several accounts at once.
//
// WHY THIS IS A SEPARATE, PRISMA-FREE MODULE
// ──────────────────────────────────────────
// The decisions a fan-out makes — who may write where, which targets already
// hold the name, what to tell the user afterwards — are exactly where the bugs
// live, and route handlers aren't unit-tested in this repo. So the decisions
// live here as pure functions and `fan-out.test.ts` pins them; the route keeps
// only the querying and the status codes.
//
// WHY COPIES AND NOT ONE SHARED ROW
// ─────────────────────────────────
// A segment is a filter, and the field catalogue is PER ACCOUNT: the same
// definition can be valid in one account and reference a custom field the next
// one never had (see planSegmentAcrossAccounts in ./lookup.ts). One row shared
// across a chosen set of accounts could therefore only ever use the fields
// every one of them has in common, and four consumers — the ad-gen offer
// email, segment composition, sync binding, and the field catalogue itself —
// assume a segment belongs to exactly one account.
//
// The alternative already exists for the case where a single shared definition
// IS right: `Audience.accountKey === null` is org-wide, resolves per account,
// and is restricted to built-in fields precisely because of the above. So this
// module handles "the same segment in these accounts", and org-wide handles
// "one segment everywhere". That split is the one `docs/settings-architecture.md`
// settled for assets: sharing is a scope, and what a scope can't express is a
// copy.

/** One account that could not be written to, and why. */
export interface FanOutFailure {
  accountKey: string;
  error: string;
}

export interface FanOutResult {
  created: Array<{ accountKey: string; id: string }>;
  failures: FanOutFailure[];
}

export interface PartitionTargetsInput {
  /** Accounts the caller asked to create in. */
  requested: string[];
  /** Accounts the caller is assigned to (`session.user.accountKeys`). */
  writableKeys: string[];
  /** developer / super_admin — may write anywhere. */
  isPrivileged: boolean;
}

export interface PartitionTargetsResult {
  /** De-duped, order-preserving, and safe to write to. */
  allowed: string[];
  /** Requested but not permitted. Non-empty means refuse the whole batch. */
  denied: string[];
}

/**
 * Split requested targets into what this caller may write and what they may not.
 *
 * Deliberately mirrors the rule the single-account create already applies in
 * `POST /api/audiences` — `isPrivileged || userAccountKeys.includes(key)`. A
 * fan-out that used a looser rule would be a way to reach accounts the
 * one-at-a-time path refuses, which is the same hole that let anyone mint an
 * org-wide segment before creation was made privileged.
 *
 * Blank and duplicate keys are dropped rather than reported: they are a client
 * serialization artifact, not a decision the user made.
 */
export function partitionTargets({
  requested,
  writableKeys,
  isPrivileged,
}: PartitionTargetsInput): PartitionTargetsResult {
  const writable = new Set(writableKeys);
  const allowed: string[] = [];
  const denied: string[] = [];
  const seen = new Set<string>();

  for (const raw of requested) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isPrivileged || writable.has(key)) allowed.push(key);
    else denied.push(key);
  }

  return { allowed, denied };
}

/**
 * Which of `targets` already holds a segment called `name`.
 *
 * `Audience` is unique on `(name, accountKey)`, and the create path does not
 * catch P2002 — a collision currently surfaces as a generic 500 with a trace
 * id, which tells the user nothing about which account to fix. Checking first
 * turns that into a 409 naming them.
 *
 * Rows with a null `accountKey` are ORG-WIDE and never a clash: Postgres treats
 * NULLs as distinct in a unique index, so an org-wide segment named "Lapsed
 * Owners" does not stop an account having its own.
 */
export function findNameClashes(
  name: string,
  targets: string[],
  existing: Array<{ name: string; accountKey: string | null }>,
): string[] {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return [];

  const taken = new Set(
    existing
      .filter((row) => row.accountKey !== null && row.name.trim().toLowerCase() === wanted)
      .map((row) => row.accountKey as string),
  );

  return targets.filter((key) => taken.has(key));
}

/**
 * What to tell the user after a fan-out, in the three-branch shape the flow and
 * form deploy modals already use. Pure so the wording is testable and stays put.
 *
 * `label` names the accounts by their display name where the caller has one,
 * because an account KEY in a toast ("youngChevOgden failed") reads as a system
 * error rather than something the user can act on.
 */
export function summarizeFanOut(
  result: FanOutResult,
  label: (accountKey: string) => string = (key) => key,
): { tone: 'success' | 'warning' | 'error'; message: string } {
  const createdCount = result.created.length;
  const failed = result.failures;

  if (createdCount === 0) {
    return {
      tone: 'error',
      message:
        failed.length > 0
          ? `No segments were created. ${failed.map((f) => `${label(f.accountKey)}: ${f.error}`).join('; ')}`
          : 'No segments were created.',
    };
  }

  const where = createdCount === 1 ? '1 account' : `${createdCount} accounts`;

  if (failed.length === 0) {
    return { tone: 'success', message: `Segment created in ${where}.` };
  }

  return {
    tone: 'warning',
    message: `Segment created in ${where}; ${failed.length} failed (${failed
      .map((f) => label(f.accountKey))
      .join(', ')}).`,
  };
}
