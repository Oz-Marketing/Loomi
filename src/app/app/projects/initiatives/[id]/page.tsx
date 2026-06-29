import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftIcon, PlusIcon } from '@heroicons/react/24/outline';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { getInitiative, listTasks, canAccess, serializeInitiative } from '@/lib/services/projects';
import { STATUSES } from '@/lib/projects/ui';
import { TaskCard } from '../../_components/task-card';
import { InitiativeHeader } from '../../_components/initiative-header';
import { InitiativeExtraDetails } from '../../_components/details-view';

export default async function InitiativeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAuthSession();
  const scope = session ? getAccountScope(session) : [];

  const initiative = await getInitiative(id);
  if (!initiative || !canAccess(scope, initiative.accountKey)) notFound();

  const tasks = await listTasks({ scope, initiativeId: id });
  const byStatus = STATUSES.map((s) => ({ ...s, tasks: tasks.filter((t) => t.status === s.key) }));
  // Progress over active tasks only — canceled tasks shouldn't drag the bar down.
  const active = tasks.filter((t) => t.status !== 'canceled');
  const done = active.filter((t) => t.status === 'done').length;
  const dto = serializeInitiative(initiative);

  return (
    <div className="py-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Initiatives
        </Link>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New ticket
        </Link>
      </div>

      <div className="mt-4">
        <InitiativeHeader
          initiative={dto}
          taskCount={active.length}
          doneCount={done}
        />
      </div>

      <div className="mt-4">
        <InitiativeExtraDetails details={dto.details} />
      </div>

      <div className="mt-6 flex gap-3 overflow-x-auto pb-4 -mx-6 px-6 md:-mx-8 md:px-8 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]">
        {byStatus.map((s) => (
          <div
            key={s.key}
            className="flex w-72 flex-shrink-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--muted)]/20 p-2"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.dot }} />
              <span className="text-sm font-medium text-[var(--foreground)]">{s.label}</span>
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">{s.tasks.length}</span>
            </div>
            <div className="flex min-h-[3rem] flex-col gap-2 px-0.5 pb-1">
              {s.tasks.map((t) => (
                <Link key={t.id} href={`/projects/tasks/${t.id}`} className="block">
                  <TaskCard task={t} showAccount={false} />
                </Link>
              ))}
              {s.tasks.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-[var(--muted-foreground)]">Nothing here</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
