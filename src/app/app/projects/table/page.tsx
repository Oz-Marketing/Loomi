import { redirect } from 'next/navigation';

/** Table folded into the unified Tasks page. Keep the old URL working. */
export default function TablePage() {
  redirect('/projects/tasks?view=table');
}
