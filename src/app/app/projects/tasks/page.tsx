import { Suspense } from 'react';
import { TasksView } from '../_components/tasks-view';

/** Unified Tasks page — Board ⇆ Table toggle over one shared filter + fetch. */
export default function TasksPage() {
  // TasksView reads `?view` via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <TasksView />
    </Suspense>
  );
}
