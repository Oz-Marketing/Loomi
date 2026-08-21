/**
 * Playbooks — pure audit orchestration.
 *
 * Takes audit contexts (built by `context.ts`) and turns them into the coverage
 * matrix the API ships. No prisma here: the whole scoring model is testable
 * against hand-built contexts.
 */

import { CHECKS_BY_ID, SEVERITY_RANK } from './checks';
import { PLAYBOOKS, PLAYBOOK_KEY_BY_CHECK } from './definitions';
import type {
  AccountAuditContext,
  AccountCoverage,
  AuditPayload,
  CheckOutcome,
  CheckResult,
  CheckWaiver,
  PlaybookResult,
} from './types';

/** Empty tally, so every caller counts the same four buckets. */
function zeroCounts() {
  return { pass: 0, warn: 0, fail: 0, na: 0 };
}

/**
 * pass / (pass + warn + fail), 0–100.
 *
 * `na` is excluded from BOTH halves. A Google check on a rooftop that doesn't
 * run Google is not a 100% and not a 0% — it isn't a question, and folding it
 * into either side would make coverage a function of how many playbooks happen
 * not to apply. Null when nothing scored at all.
 */
export function coveragePct(counts: { pass: number; warn: number; fail: number }): number | null {
  const scored = counts.pass + counts.warn + counts.fail;
  if (scored === 0) return null;
  return Math.round((counts.pass / scored) * 100);
}

/**
 * Fold a waiver into a check's outcome.
 *
 * The check still RUNS and its observed detail is still carried — a waiver is
 * "we accept this", not "don't look". What changes is the score: a waived check
 * counts as `na`, excluded from coverage entirely, the same as a playbook that
 * doesn't apply. That is what the person waiving it asserted.
 *
 * A waiver on a check that is currently PASSING is left alone. Scoring a pass as
 * `na` would quietly shrink the denominator and inflate coverage, and a waiver
 * that outlived the problem it excused should read as spent, not as credit.
 */
export function applyWaiver(outcome: CheckOutcome, waiver: CheckWaiver | undefined): {
  outcome: CheckOutcome;
  waived?: CheckWaiver;
} {
  if (!waiver) return { outcome };
  if (outcome.status === 'pass' || outcome.status === 'na') return { outcome };
  return {
    outcome: { status: 'na', detail: outcome.detail },
    waived: waiver,
  };
}

function runPlaybook(ctx: AccountAuditContext, definition: (typeof PLAYBOOKS)[number]): PlaybookResult {
  const applies = definition.appliesTo(ctx);
  const counts = zeroCounts();

  const checks: CheckResult[] = definition.checkIds
    .map((id) => CHECKS_BY_ID.get(id))
    // A definition naming a check that no longer exists is a code bug, but it
    // should cost one row rather than the whole audit.
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((check) => {
      const raw = applies ? check.run(ctx) : { status: 'na' as const, detail: 'playbook does not apply' };
      const { outcome, waived } = applyWaiver(raw, ctx.waivers[check.id]);
      counts[outcome.status] += 1;
      return {
        id: check.id,
        label: check.label,
        why: check.why,
        severity: check.severity,
        ...(check.fix ? { fix: check.fix } : {}),
        ...(waived ? { waived } : {}),
        ...outcome,
      };
    })
    .sort((a, b) => {
      // Worst first: severity, then status within a severity, so a blocking
      // failure can never render under an advisory pass.
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      const rank = { fail: 0, warn: 1, pass: 2, na: 3 };
      return rank[a.status] - rank[b.status];
    });

  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    applies,
    checks,
    counts,
  };
}

export function auditAccount(ctx: AccountAuditContext): AccountCoverage {
  const playbooks = PLAYBOOKS.map((p) => runPlaybook(ctx, p));

  const counts = zeroCounts();
  let blockingFails = 0;
  for (const p of playbooks) {
    counts.pass += p.counts.pass;
    counts.warn += p.counts.warn;
    counts.fail += p.counts.fail;
    counts.na += p.counts.na;
    for (const c of p.checks) {
      if (c.status === 'fail' && c.severity === 'blocking') blockingFails += 1;
    }
  }

  return {
    accountKey: ctx.accountKey,
    dealer: ctx.dealer,
    slug: ctx.slug,
    category: ctx.category,
    makes: ctx.makes,
    playbooks,
    counts,
    coveragePct: coveragePct(counts),
    blockingFails,
  };
}

/**
 * The cross-account rollup: one row per check, with the accounts failing it.
 *
 * This is the view that scopes Phase 1 — a check green everywhere is a step not
 * worth automating, a check red on thirty rooftops is the first thing the apply
 * engine should do.
 */
function rollupByCheck(accounts: AccountCoverage[]): AuditPayload['byCheck'] {
  const rows = new Map<string, AuditPayload['byCheck'][number]>();

  for (const account of accounts) {
    for (const playbook of account.playbooks) {
      for (const check of playbook.checks) {
        let row = rows.get(check.id);
        if (!row) {
          row = {
            id: check.id,
            label: check.label,
            why: check.why,
            severity: check.severity,
            playbookKey: PLAYBOOK_KEY_BY_CHECK.get(check.id) ?? playbook.key,
            ...zeroCounts(),
            failingAccounts: [],
          };
          rows.set(check.id, row);
        }
        row[check.status] += 1;
        // Warnings are listed alongside failures: "approved, but the design
        // moved" is work someone has to do, even though it isn't a hard stop.
        if (check.status === 'fail' || check.status === 'warn') {
          row.failingAccounts.push({
            accountKey: account.accountKey,
            dealer: account.dealer,
            detail: check.detail,
          });
        }
      }
    }
  }

  return [...rows.values()].sort((a, b) => {
    const byFail = b.fail + b.warn - (a.fail + a.warn);
    if (byFail !== 0) return byFail;
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  });
}

export function buildAuditPayload(
  contexts: AccountAuditContext[],
  opts: { period: string; generatedAt: Date },
): AuditPayload {
  const accounts = contexts
    .map(auditAccount)
    // Worst first — the rooftops that need attention are the point of the page.
    .sort((a, b) => {
      if (b.blockingFails !== a.blockingFails) return b.blockingFails - a.blockingFails;
      const ac = a.coveragePct ?? 101; // nothing-applies sorts last, not first
      const bc = b.coveragePct ?? 101;
      if (ac !== bc) return ac - bc;
      return a.dealer.localeCompare(b.dealer);
    });

  return {
    generatedAt: opts.generatedAt.toISOString(),
    period: opts.period,
    accounts,
    byCheck: rollupByCheck(accounts),
  };
}
