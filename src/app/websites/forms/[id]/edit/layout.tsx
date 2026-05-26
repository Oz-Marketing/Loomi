/**
 * Workspace chrome for the form builder.
 *
 * The builder needs the focused, full-viewport treatment (no app
 * sidebar, no top utility bar) — same as the email template editor.
 * LayoutShell's isWebsiteBuilder regex matches `/edit` and strips the
 * standard app shell, leaving this layout to provide the top toolbar
 * and the calc-sized container the FormBuilderPage fills.
 */
import { FormDetailHeader } from '@/components/forms/form-detail-header';

export default function FormBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      <FormDetailHeader />
      {children}
    </div>
  );
}
