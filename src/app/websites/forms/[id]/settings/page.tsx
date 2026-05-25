'use client';

import { AdminOnly } from '@/components/route-guard';
import { FormSettingsForm } from '@/components/forms/form-settings-form';

export default function FormSettingsPage() {
  // Settings + Submissions sit inside the email-editor-style chrome
  // (h-[calc(100vh-2rem)] flex flex-col). Inner pane owns its own scroll.
  return (
    <AdminOnly>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <FormSettingsForm />
      </div>
    </AdminOnly>
  );
}
