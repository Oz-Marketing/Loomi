import { redirect } from 'next/navigation';

/**
 * Legacy route preserved for any bookmarks pointing at the old single-page
 * tool. The Meta planner now lives at /tools/meta/ad-planner with a
 * companion Ad Pacer page at /tools/meta/ad-pacer; we forward straight to
 * Ad Planner since it's the action-heavy surface most visitors want.
 */
export default function LegacyMetaAdsPacerRedirect() {
  redirect('/tools/meta/ad-planner');
}
