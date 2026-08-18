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
import type {
  AccountCoverage,
  AuditPayload,
  CheckResult,
  CheckSeverity,
  CheckStatus,
  PlaybookResult,
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
  const { data, error, isLoading, mutate, isValidating } = useSWR<AuditPayload>(
    '/api/playbooks/audit',
    fetcher,
    { revalidateOnFocus: false },
  );
  const [tab, setTab] = useState<Tab>('accounts');

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
            ? `Coverage audit across ${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'} · ${data.period}`
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
                <AccountRow key={account.accountKey} account={account} />
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
      <span className="font-medium text-[var(--foreground)]">Read-only.</span> Nothing here changes a
      account. Which playbooks apply is <em>inferred</em> from what each account has configured —
      a rooftop that deliberately doesn&apos;t run a channel can still show as missing it. Applying
      playbooks explicitly, so applicability is a recorded fact rather than a guess, is Phase 1.
    </div>
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

function AccountRow({ account }: { account: AccountCoverage }) {
  const [open, setOpen] = useState(false);
  const applied = account.playbooks.filter((p) => p.applies);

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
                <PlaybookSection key={playbook.key} playbook={playbook} account={account} />
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
}: {
  playbook: PlaybookResult;
  account: AccountCoverage;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold">{playbook.name}</h4>
        <span className="text-xs text-[var(--muted-foreground)]">{playbook.description}</span>
      </div>
      <div className="mt-2 divide-y divide-[var(--border)]">
        {playbook.checks.map((check) => (
          <CheckLine key={check.id} check={check} account={account} />
        ))}
      </div>
    </div>
  );
}

function CheckLine({ check, account }: { check: CheckResult; account: AccountCoverage }) {
  const href = check.fix && check.status !== 'pass' ? fixHref(check.fix, account) : null;

  return (
    <div className="flex items-start gap-3 py-2">
      <StatusDot status={check.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{check.label}</span>
          <HelpTip title={check.label} iconClassName="h-3.5 w-3.5">
            <p>{check.why}</p>
            <p>
              <strong>{SEVERITY_LABEL[check.severity]}</strong> check.
            </p>
          </HelpTip>
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">{check.detail}</div>
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
