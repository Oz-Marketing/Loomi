import { redirect } from 'next/navigation';

// The Email/Text section was renamed from "Campaigns" to "Blasts" (to avoid
// colliding with the AI Campaign Builder). Keep the old path working for
// bookmarks and any lingering /messaging/campaigns links.
export default function MessagingCampaignsRedirect() {
  redirect('/messaging/blasts');
}
