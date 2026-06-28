import { notFound } from 'next/navigation';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { getTaskWithThread, canAccess } from '@/lib/services/projects';
import { TaskDetail } from '../../_components/task-detail';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAuthSession();
  const scope = session ? getAccountScope(session) : [];

  const data = await getTaskWithThread(id);
  if (!data || !canAccess(scope, data.task.accountKey)) notFound();

  return <TaskDetail initial={data} />;
}
