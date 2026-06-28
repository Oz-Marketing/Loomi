import Link from 'next/link';
import { cookies } from 'next/headers';
import { PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { getAuthSession, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { listInitiatives } from '@/lib/services/projects';
import { ACTIVE_ACCOUNT_COOKIE, ADMIN_VALUE } from '@/lib/active-account';
import { PRIORITY_META, formatShortDate, type PriorityKey } from '@/lib/projects/ui';

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-blue-500/10 text-blue-500',
  on_hold: 'bg-amber-500/10 text-amber-600',
  completed: 'bg-green-500/10 text-green-600',
  archived: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
};

/** Initiatives overview — per-account bodies of work. Server-rendered. */
export default async function ProjectsHomePage() {
  const session = await getAuthSession();
  const scope = session ? getAccountScope(session) : [];

  // Scope to the active sub-account (shared cookie) when one is selected and
  // the user may access it; Admin / unset shows everything in scope.
  const activeRaw = (await cookies()).get(ACTIVE_ACCOUNT_COOKIE)?.value ?? null;
  const accountKey =
    activeRaw && activeRaw !== ADMIN_VALUE && canAccessAccount(scope, activeRaw)
      ? activeRaw
      : undefined;

  const initiatives = await listInitiatives({ scope, accountKey });

  return (
    <div className="py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">Initiatives</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Bodies of work per account — onboarding, launches, campaigns.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New ticket
        </Link>
      </div>

      {initiatives.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <RectangleStackIcon className="h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">No initiatives yet</p>
          <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
            Submit a ticket to spin up work across the team. Initiatives group all the
            tasks for an account&apos;s onboarding, launch, or campaign.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {initiatives.map((i) => {
            const pr = PRIORITY_META[i.priority as PriorityKey] ?? PRIORITY_META.medium;
            const pct = i.taskCount > 0 ? Math.round((i.doneCount / i.taskCount) * 100) : 0;
            return (
              <Link
                key={i.id}
                href={`/projects/initiatives/${i.id}`}
                className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]/50 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[i.status] ?? STATUS_BADGE.active}`}>
                    {i.status.replace('_', ' ')}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pr.color }} />
                    {pr.label}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--foreground)] line-clamp-2">{i.name}</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{i.accountDealer ?? '—'}</p>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                    <span>
                      {i.doneCount}/{i.taskCount} done
                    </span>
                    {i.dueDate && <span>Due {formatShortDate(i.dueDate)}</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
