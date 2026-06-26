import { redirect } from 'next/navigation';

/**
 * App surface home. On app.loomilm.com the browser hits `/` which the proxy
 * rewrites to `/app`; land the user on the Projects workspace. (When the
 * Reporting tree relocates here, this becomes a real App home / launcher.)
 */
export default function AppIndexPage() {
  redirect('/projects');
}
