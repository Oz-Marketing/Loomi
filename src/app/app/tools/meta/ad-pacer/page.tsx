import { redirect } from 'next/navigation';

// The Ad Planner + Ad Pacer pages were consolidated into /tools/meta with an
// in-page Plan/Pace toggle. Keep this path as a redirect so existing links and
// bookmarks land on the Pacer view.
export default function MetaAdPacerPage() {
  redirect('/tools/meta?view=pacer');
}
