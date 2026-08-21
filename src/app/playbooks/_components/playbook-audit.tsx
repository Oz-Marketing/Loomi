'use client';

import { useMemo, useState } from 'react';
import { PlaybookLibrary } from './playbook-library';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/page-header';
import { HelpTip } from '@/components/ui/help-tip';
import { getAppUrl } from '@/lib/cross-site';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from 'sonner';
import type {
  AccountCoverage,
  AuditPayload,
  CheckResult,
  CheckSeverity,
  CheckStatus,
  PlaybookResult,
  SweepSummary,
} from '@/lib/playbooks/types';

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Request failed');
    return r.json() as Promise<AuditPayload>;
  });

type Tab = 'accounts' | 'checks' | 'library';

/**
 * Status colours, shared by the dots, bars and counters so one signal set reads
 * across the page. Literal hex to match the pacer's status tables — the theme
 * has no semantic success/danger token, and both themes carry these unchanged.
 */
const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: '#22c55e',
  warn: '#f59e0b',
  fail: '#ef4444',
  na: 'var(--muted-foreground)',
};

/** The four buckets every tally uses. */
type Counts = { pass: number; warn: number; fail: number; na: number };

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'Pass',
  warn: 'Needs attention',
  fail: 'Missing',
  na: 'Not applicable',
};

const SEVERITY_LABEL: Record<CheckSeverity, string> = {
  blocking: 'Blocking',
  standard: 'Standard',
  advisory: 'Advisory',
};

/** Resolve a check's fix link, which may point at the other host. */
function fixHref(fix: NonNullable<CheckResult['fix']>, account: { accountKey: string; slug: string }) {
  const path = fix.path.replace('{key}', account.accountKey).replace('{slug}', account.slug);
  // This page lives on STUDIO, so studio fixes are same-host links and it's the
  // App ones (the pacer, the budget hub) that have to cross. Inverted when the
  // page moved off the App surface — left as it was, every link would have
  // pointed at the wrong host.
  //
  // getAppUrl returns null during SSR; the anchor renders unlinked until
  // hydration, which is the same behaviour getStudioUrl had here before.
  return fix.surface === 'app' ? getAppUrl(path) : path;
}

export function PlaybookAudit() {
  const { isAllAccounts, scopedAccountKeys, accountsLoaded } = useAccount();

  /**
   * The audit follows the account selector (docs/account-scope.md): one account
   * audits itself, a group audits its whole subtree, and All accounts audits
   * everything the session may see.
   *
   * `null` until the account context has settled. The server reads "no keys" as
   * "everything I may see", so firing early with an empty list would flash the
   * entire roster at someone who has one account selected — and it would look
   * like the scope simply doesn't work.
   */
  const auditKey = !accountsLoaded
    ? null
    : isAllAccounts
      ? '/api/playbooks/audit'
      : scopedAccountKeys.length
        ? `/api/playbooks/audit?accountKeys=${encodeURIComponent(scopedAccountKeys.join(','))}`
        : null;

  const { data, error, isLoading, mutate, isValidating } = useSWR<AuditPayload>(
    auditKey,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [tab, setTab] = useState<Tab>('accounts');
  const { prompt, confirm } = useLoomiDialog();

  /**
   * Waive a check on one account — record "this is not a question here" instead
   * of leaving a red nobody can act on (docs/playbooks.md §4.3).
   *
   * The reason is REQUIRED, and asked for before anything is written. A waiver
   * with no reason is indistinguishable from ignoring the row, and the person
   * reading it in six months has no way to tell a considered exemption from a
   * shrug — so the prompt is the feature, not a formality.
   */
  async function waiveCheck(account: AccountCoverage, check: CheckResult) {
    const reason = await prompt({
      title: `Waive "${check.label}"`,
      message:
        `Why does this not apply to ${account.dealer}? This is recorded against your name, ` +
        'and the check stops counting toward coverage until someone lifts it.',
      placeholder: 'e.g. this rooftop does not run Google — handled by the OEM',
      confirmLabel: 'Waive',
      required: true,
      multiline: true,
    });
    if (!reason?.trim()) return;
    try {
      const res = await fetch('/api/playbooks/waivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: account.accountKey, checkId: check.id, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the waiver');
    }
  }

  /** Put a waived check back in the score. */
  async function liftWaiver(account: AccountCoverage, check: CheckResult) {
    const ok = await confirm({
      title: `Score "${check.label}" again`,
      message: `${account.dealer} will be measured on this check again, and its coverage will change.`,
      confirmLabel: 'Score it again',
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/playbooks/waivers?accountKey=${encodeURIComponent(account.accountKey)}` +
          `&checkId=${encodeURIComponent(check.id)}`,
        { method: 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not lift the waiver');
    }
  }

  const summary = useMemo(() => {
    if (!data) return null;
    const scored = data.accounts.filter((a) => a.coveragePct != null);
    const avg = scored.length
      ? Math.round(scored.reduce((n, a) => n + (a.coveragePct ?? 0), 0) / scored.length)
      : null;
    return {
      accounts: data.accounts.length,
      avg,
      blocking: data.accounts.reduce((n, a) => n + a.blockingFails, 0),
      needsWork: data.accounts.filter((a) => a.counts.fail + a.counts.warn > 0).length,
    };
  }, [data]);

  return (
    <div>
      <PageHeader
        icon={ClipboardDocumentCheckIcon}
        title="Playbooks"
        subtitle={
          data
            ? `${isAllAccounts ? 'All accounts' : 'Selected scope'} · ${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'} · ${data.period}`
            : 'Coverage audit'
        }
        actions={
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isValidating}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} />
            Re-run
          </button>
        }
        tabs={
          <>
            <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>
              By account
            </TabButton>
            <TabButton active={tab === 'checks'} onClick={() => setTab('checks')}>
              By check
            </TabButton>
            <TabButton active={tab === 'library'} onClick={() => setTab('library')}>
              Library
            </TabButton>
          </>
        }
      />

      {/* The audit's caveats and its fetch states belong to the audit only —
          the Library is a separate screen that must render even when the audit
          is still running or has failed. */}
      {tab !== 'library' && <PhaseNotice />}

      {tab !== 'library' && data && <SweepStatus sweep={data.lastSweep ?? null} />}

      {tab === 'library' && <PlaybookLibrary />}

      {tab !== 'library' && error && (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-sm text-[var(--foreground)]">Couldn&apos;t run the audit.</p>
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm transition hover:bg-[var(--muted)]"
          >
            Retry
          </button>
        </div>
      )}

      {tab !== 'library' && isLoading && !data && (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--muted-foreground)]">
          Running checks…
        </div>
      )}

      {tab !== 'library' && data && summary && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Accounts" value={String(summary.accounts)} />
            <Stat label="Average coverage" value={summary.avg == null ? '—' : `${summary.avg}%`} />
            <Stat
              label="Blocking failures"
              value={String(summary.blocking)}
              tone={summary.blocking > 0 ? 'fail' : 'pass'}
            />
            <Stat label="Need work" value={`${summary.needsWork} of ${summary.accounts}`} />
          </div>

          {data.accounts.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--muted-foreground)]">
              No accounts in scope.
            </div>
          ) : tab === 'accounts' ? (
            <div className="mt-4 space-y-2">
              {data.accounts.map((account) => (
                <AccountRow
                  key={account.accountKey}
                  account={account}
                  onWaive={waiveCheck}
                  onLift={liftWaiver}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {data.byCheck.map((row) => (
                <CheckRollupRow key={row.id} row={row} total={data.accounts.length} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-[var(--primary)] font-medium text-[var(--primary)]'
          : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The applicability caveat, stated on the page rather than only in the spec.
 * Phase 0 infers which playbooks apply from observable account facts, and a
 * reader deciding whether to act on a red row needs to know that.
 */
function PhaseNotice() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
      Which playbooks apply is <em>inferred</em> from what each account has configured, so a
      rooftop that deliberately doesn&apos;t run a channel can still show as missing it. When
      that happens, use <span className="font-medium text-[var(--foreground)]">Not
      applicable</span> on the check and say why — it stops counting toward that account&apos;s
      coverage, and the reason is kept. Applying playbooks explicitly, so applicability is a
      recorded fact rather than a guess, is Phase 1.
    </div>
  );
}

/**
 * The nightly sweep's heartbeat.
 *
 * Without this line, a sweep that has been dead for three weeks and a week where
 * nothing drifted look exactly the same — the page renders a fresh on-demand
 * audit either way, so the screen stays reassuring while the alerting behind it
 * is gone. This is the only thing that tells them apart.
 */
function SweepStatus({ sweep }: { sweep: SweepSummary | null }) {
  if (!sweep) {
    return (
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        The nightly sweep hasn&apos;t run yet. Everything below was computed just now, on demand.
      </p>
    );
  }

  const started = new Date(sweep.startedAt);
  const hours = (Date.now() - started.getTime()) / 3_600_000;
  // A daily job gets a day and a half before it counts as late — a sweep that
  // ran 25 hours ago is a clock skew, not an incident.
  const late = hours > 36;
  const when = started.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (sweep.error) {
    return (
      <p className="mt-2 text-xs" style={{ color: STATUS_COLOR.fail }}>
        The nightly sweep failed on {when}: {sweep.error}
      </p>
    );
  }
  if (!sweep.finishedAt) {
    return (
      <p className="mt-2 text-xs" style={{ color: STATUS_COLOR.warn }}>
        The sweep started on {when} and never finished — it may still be running, or it died
        mid-run.
      </p>
    );
  }

  return (
    <p
      className="mt-2 text-xs"
      style={late ? { color: STATUS_COLOR.warn } : { color: 'var(--muted-foreground)' }}
    >
      Nightly sweep {late ? 'last ran' : 'ran'} {when} · {sweep.accountsAudited} account
      {sweep.accountsAudited === 1 ? '' : 's'} · {sweep.blockingFails} blocking
      {sweep.coveragePct == null ? '' : ` · ${sweep.coveragePct}% average coverage`}
      {late ? ' — that is more than a day ago.' : ''}
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pass' | 'fail' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] px-4 py-3">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div
        className="mt-1 text-xl font-semibold"
        style={tone ? { color: STATUS_COLOR[tone] } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/** Segmented pass/warn/fail bar. `na` is not drawn — it isn't part of the score. */
function CoverageBar({ counts }: { counts: Counts }) {
  const scored = counts.pass + counts.warn + counts.fail;
  if (scored === 0) {
    return <div className="h-1.5 w-full rounded-full bg-[var(--muted)]" />;
  }
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
      {(['pass', 'warn', 'fail'] as const).map((k) =>
        counts[k] > 0 ? (
          <div
            key={k}
            style={{ width: `${(counts[k] / scored) * 100}%`, background: STATUS_COLOR[k] }}
            title={`${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`}
          />
        ) : null,
      )}
    </div>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  return (
    <span
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}

function AccountRow({
  account,
  onWaive,
  onLift,
}: {
  account: AccountCoverage;
  onWaive: (account: AccountCoverage, check: CheckResult) => void;
  onLift: (account: AccountCoverage, check: CheckResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const applied = account.playbooks.filter((p) => p.applies);
  // Waivers are counted on the collapsed row: a rooftop at 100% because six
  // checks were waived is a different fact from one at 100% outright, and
  // hiding that behind an expander is how a waiver becomes a way to make a
  // number look good.
  const waivedCount = applied.reduce(
    (n, p) => n + p.checks.filter((c) => c.waived).length,
    0,
  );

  return (
    <div className="rounded-2xl border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-[var(--muted)]/40"
      >
        <ChevronRightIcon
          className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{account.dealer}</span>
            {account.makes.length > 0 && (
              <span className="truncate text-xs text-[var(--muted-foreground)]">
                {account.makes.join(' · ')}
              </span>
            )}
          </div>
          <div className="mt-2 max-w-md">
            <CoverageBar counts={account.counts} />
          </div>
        </div>

        {account.blockingFails > 0 && (
          <span
            className="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: STATUS_COLOR.fail, color: '#fff' }}
          >
            {account.blockingFails} blocking
          </span>
        )}
        {waivedCount > 0 && (
          <span
            className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
            title={`${waivedCount} check${waivedCount === 1 ? '' : 's'} waived — excluded from this account's coverage`}
          >
            {waivedCount} waived
          </span>
        )}
        <div className="w-20 shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums">
            {account.coveragePct == null ? '—' : `${account.coveragePct}%`}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {applied.length} playbook{applied.length === 1 ? '' : 's'}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          {applied.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
              No playbook applies to this account.
            </p>
          ) : (
            <div className="space-y-5">
              {applied.map((playbook) => (
                <PlaybookSection
                  key={playbook.key}
                  playbook={playbook}
                  account={account}
                  onWaive={onWaive}
                  onLift={onLift}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlaybookSection({
  playbook,
  account,
  onWaive,
  onLift,
}: {
  playbook: PlaybookResult;
  account: AccountCoverage;
  onWaive: (account: AccountCoverage, check: CheckResult) => void;
  onLift: (account: AccountCoverage, check: CheckResult) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold">{playbook.name}</h4>
        <span className="text-xs text-[var(--muted-foreground)]">{playbook.description}</span>
      </div>
      <div className="mt-2 divide-y divide-[var(--border)]">
        {playbook.checks.map((check) => (
          <CheckLine
            key={check.id}
            check={check}
            account={account}
            onWaive={onWaive}
            onLift={onLift}
          />
        ))}
      </div>
    </div>
  );
}

function CheckLine({
  check,
  account,
  onWaive,
  onLift,
}: {
  check: CheckResult;
  account: AccountCoverage;
  onWaive: (account: AccountCoverage, check: CheckResult) => void;
  onLift: (account: AccountCoverage, check: CheckResult) => void;
}) {
  const href = check.fix && check.status !== 'pass' ? fixHref(check.fix, account) : null;
  // Only a red or an amber can be waived. Waiving a PASS would shrink the
  // denominator and inflate coverage, and waiving an already-inapplicable check
  // asserts nothing.
  const waivable = !check.waived && (check.status === 'fail' || check.status === 'warn');

  return (
    <div className="flex items-start gap-3 py-2">
      <StatusDot status={check.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${check.waived ? 'text-[var(--muted-foreground)]' : ''}`}>
            {check.label}
          </span>
          <HelpTip title={check.label} iconClassName="h-3.5 w-3.5">
            <p>{check.why}</p>
            <p>
              <strong>{SEVERITY_LABEL[check.severity]}</strong> check.
            </p>
          </HelpTip>
          {check.waived && (
            <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
              Waived
            </span>
          )}
        </div>
        {/* The OBSERVED state is still shown on a waived check. A waiver says
            "we accept this", so hiding what was accepted defeats the point. */}
        <div className="text-xs text-[var(--muted-foreground)]">{check.detail}</div>
        {check.waived && (
          <div className="mt-0.5 text-xs italic text-[var(--muted-foreground)]">
            &ldquo;{check.waived.reason}&rdquo;
            {check.waived.waivedByName ? ` — ${check.waived.waivedByName}` : ''}
          </div>
        )}
      </div>
      {href && (
        <a
          href={href}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-[var(--primary)] hover:underline"
        >
          {check.fix!.label}
          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
        </a>
      )}
      {waivable && (
        <button
          type="button"
          onClick={() => onWaive(account, check)}
          className="shrink-0 whitespace-nowrap text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] hover:underline"
        >
          Not applicable
        </button>
      )}
      {check.waived && (
        <button
          type="button"
          onClick={() => onLift(account, check)}
          className="shrink-0 whitespace-nowrap text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] hover:underline"
        >
          Score it again
        </button>
      )}
    </div>
  );
}

function CheckRollupRow({
  row,
  total,
}: {
  row: AuditPayload['byCheck'][number];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const scored = row.pass + row.warn + row.fail;
  const needsWork = row.fail + row.warn;

  // The toggle is its own button covering the chevron, label and bar — the
  // HelpTip and severity chip are siblings, not children. A HelpTip button
  // nested inside the toggle would be invalid markup and one click would fire
  // both handlers.
  return (
    <div className="rounded-2xl border border-[var(--border)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={needsWork === 0}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left transition hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100"
        >
          <ChevronRightIcon
            className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${
              needsWork === 0 ? 'text-transparent' : 'text-[var(--muted-foreground)]'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{row.label}</div>
            <div className="mt-2 max-w-md">
              <CoverageBar counts={{ pass: row.pass, warn: row.warn, fail: row.fail, na: row.na }} />
            </div>
          </div>
        </button>

        <HelpTip title={row.label} iconClassName="h-3.5 w-3.5">
          <p>{row.why}</p>
          <p>
            <strong>{SEVERITY_LABEL[row.severity]}</strong> check.
          </p>
        </HelpTip>
        <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {SEVERITY_LABEL[row.severity]}
        </span>

        <div className="w-32 shrink-0 text-right text-sm tabular-nums">
          {needsWork === 0 ? (
            <span style={{ color: STATUS_COLOR.pass }}>All clear</span>
          ) : (
            <span style={{ color: STATUS_COLOR[row.fail > 0 ? 'fail' : 'warn'] }}>
              {needsWork} of {scored}
            </span>
          )}
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {row.na > 0 ? `${row.na} of ${total} n/a` : 'applies to all'}
          </div>
        </div>
      </div>

      {open && needsWork > 0 && (
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {row.failingAccounts.map((a) => (
            <li key={a.accountKey} className="flex items-baseline gap-3 px-4 py-2 pl-11">
              <span className="w-56 shrink-0 truncate text-sm">{a.dealer}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{a.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
