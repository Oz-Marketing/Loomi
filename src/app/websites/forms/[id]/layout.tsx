import { notFound, redirect } from 'next/navigation';
import { getAccountScope, getAuthSession } from '@/lib/api-auth';
import { getForm } from '@/lib/services/forms';
import { FormDetailHeader } from '@/components/forms/form-detail-header';
import { FormDetailProvider } from '@/components/forms/form-detail-context';
import { FormDetailTabs } from '@/components/forms/form-detail-tabs';

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

  // Match the email template editor's chrome: a 3-column top toolbar
  // with the click-to-edit title, then a thin tabs row, then the page
  // content. The outer wrapper sizes to the available viewport minus
  // the app shell's 1rem padding (same calc the email editor uses).
  return (
    <FormDetailProvider initialForm={form}>
      <div className="flex flex-col h-[calc(100vh-2rem)]">
        <FormDetailHeader />
        <FormDetailTabs formId={form.id} />
        {children}
      </div>
    </FormDetailProvider>
  );
}
