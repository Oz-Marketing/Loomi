import { redirect } from 'next/navigation';

// Teams moved into the shared Settings surface as a tab. Redirect old links
// (browser /projects/teams → /settings/teams, rewritten to /app/settings/teams
// on the App host).
export default function TeamsRedirectPage() {
  redirect('/settings/teams');
}
