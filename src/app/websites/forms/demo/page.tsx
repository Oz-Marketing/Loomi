'use client';

import * as React from 'react';
import { AdminOnly } from '@/components/route-guard';
import { FormEditorShell } from '@/lib/forms/editor/FormEditorShell';
import { emptyFormTemplate, type FormTemplate } from '@/lib/forms/types';

/**
 * Throwaway demo route for PR2. Mounts the builder against in-memory
 * state so the drag-drop + property panel can be exercised end-to-end
 * before list + persistence land in PR3. Will be removed once
 * /websites/forms/[id] is wired to the real Form record.
 */
export default function FormBuilderDemoPage() {
  const [template, setTemplate] = React.useState<FormTemplate>(() => emptyFormTemplate());

  return (
    <AdminOnly>
      <div className="h-[calc(100vh-1.5rem)] p-3">
        <FormEditorShell template={template} onChange={setTemplate} />
      </div>
    </AdminOnly>
  );
}
