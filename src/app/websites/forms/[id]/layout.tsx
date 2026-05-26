import { notFound, redirect } from 'next/navigation';
import { getAccountScope, getAuthSession } from '@/lib/api-auth';
import { getForm } from '@/lib/services/forms';
import { FormDetailProvider } from '@/components/forms/form-detail-context';
import { FormSettingsModal } from '@/components/forms/form-settings-modal';

/**
 * Detail-area shell. Fetches the form once and exposes it via
 * FormDetailProvider so the overview / builder / settings / submissions
 * pages can share state without each one refetching.
 *
 * Page chrome (header, action bar) lives in the individual pages now —
 * the overview sits in the regular app shell, while the builder owns a
 * full-viewport workspace via /edit/layout.tsx. The IA mirrors Flows
 * (overview at /flows/[id], builder at /flows/[id]/edit).
 */
export default async function FormDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getAuthSession();
  if (!session?.user) redirect('/login');
  if (!['developer', 'super_admin', 'admin'].includes(session.user.role)) notFound();

  const { id } = await params;
  const form = await getForm(id, getAccountScope(session));
  if (!form) notFound();

  return (
    <FormDetailProvider initialForm={form}>
      {children}
      {/* Settings modal lives at the layout level so the cog buttons
          on every page (overview, builder) can open it without each
          page mounting its own copy. */}
      <FormSettingsModal />
    </FormDetailProvider>
  );
}
