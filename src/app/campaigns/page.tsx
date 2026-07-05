import { redirect } from 'next/navigation';

// Old top-level path — keep working for bookmarks + internal
// router.push('/campaigns') calls until those are migrated.
export default function CampaignsRedirect() {
  redirect('/messaging/blasts');
}
