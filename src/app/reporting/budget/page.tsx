'use client';

/**
 * Budget — the read-only, client-facing view of the budget ledger.
 *
 * READ-ONLY BY DESIGN, and a different audience from the budget hub at
 * /app/projects/budget. The hub is where staff author budget: it edits lines,
 * distributes the pool, settles months, and shows Oz's cost and margin. This
 * page shows a dealer their own budget and nothing else. Everything editorial
 * stays in the hub — there is no "add line" here on purpose.
 *
 * A YEAR PICKER, NOT A DATE RANGE. A budget is an annual instrument: the
 * contract commits a year, the pool belongs to a year, and every line carries
 * `year` as its anchor. An arbitrary range would slice months out of a total
 * that only means anything whole.
 */

import { useState } from 'react';
import { BanknotesIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { BudgetReport } from './_components/budget-report';

/** The current year and the two before it — as far back as the ledger is useful. */
function recentYears(): number[] {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2];
}

function YearPicker({ value, onChange }: { value: number; onChange: (y: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-[var(--border)] p-0.5">
      {recentYears().map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => onChange(y)}
          className={`rounded-md px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
            value === y
              ? 'bg-[var(--primary)] text-white'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

export default function ReportingBudgetPage() {
  const { accountKey, accountData, isRollup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [year, setYear] = useState(() => new Date().getFullYear());

  const scopeLabel = accountKey && !isRollup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={BanknotesIcon}
        title="Budget"
        subtitle={`Contracted budget, what's planned against it, and what's been spent — ${scopeLabel}.`}
      />

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <YearPicker value={year} onChange={setYear} />
      </div>

      {/* Deliberately NOT rolled up. `BUDGET_ROLLUP` is `supportsDates: false`,
          so the roll-up would never receive the year this page's picker selects
          — it would report some other year under the year you chose. Wiring it
          means teaching the config to carry a year first. */}
      {isRollup || !accountKey ? (
        <EmptyState
          icon={BanknotesIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its budget."
        />
      ) : (
        <BudgetReport accountKey={accountKey} year={year} isDark={isDark} />
      )}
    </>
  );
}
