import { redirect } from 'next/navigation';

/** Board folded into the unified Tasks page. Keep the old URL working. */
export default function BoardPage() {
  redirect('/projects/tasks');
}
