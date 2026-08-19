'use client';

import { useAccount } from '@/contexts/account-context';

/**
 * How this page slices the selected account: the group's own numbers, or the
 * whole subtree.
 *
 * WHY IT LIVES IN THE PAGE HEADER. This used to be a segmented control inside
 * the account switcher's dropdown, under the selected group's row. That put a
 * per-PAGE question inside the global account picker, where it read as a mode
 * you set once and forgot — and a forgotten roll-up setting is how you end up
 * reading the wrong numbers on some other page a week later. Here it sits on
 * the page it actually changes, next to the scope it describes.
 *
 * A group like Young Automotive Group is BOTH an entity that advertises for
 * itself and a parent that rolls up rooftops (see `Account` in the schema), so
 * something has to disambiguate its row. See docs/account-scope.md.
 *
 * Renders NOTHING unless the selection is a group. A leaf account has nothing
 * to roll up, and the all-accounts overview has no single group to stand alone —
 * in both cases a toggle would be a control that does nothing.
 */
export function AccountScopeToggle({ className = '' }: { className?: string }) {
  const { accountKey, accountData, isGroup, isSelfScoped, setRollup, childCounts } = useAccount();

  if (!isGroup || !accountKey) return null;

  const kids = childCounts[accountKey] ?? 0;
  const name = accountData?.dealer || accountKey;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-[var(--border)] py-1 pl-2.5 pr-1 ${className}`}
    >
      <span className="max-w-[180px] truncate text-xs text-[var(--muted-foreground)]">{name}</span>
      <div className="flex items-center gap-0.5 rounded-md bg-[var(--muted)]/60 p-0.5">
        {(
          [
            [true, kids ? `All ${kids}` : 'Roll up', `Its own numbers plus all ${kids}`],
            [false, 'Just this', 'This account on its own'],
          ] as const
        ).map(([rollup, label, hint]) => {
          const active = rollup ? !isSelfScoped : isSelfScoped;
          return (
            <button
              key={label}
              type="button"
              title={hint}
              aria-pressed={active}
              onClick={() => setRollup(rollup)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--card-strong)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
