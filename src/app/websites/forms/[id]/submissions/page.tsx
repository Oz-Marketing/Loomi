'use client';

import { AdminOnly } from '@/components/route-guard';
import { SubmissionsTable } from '@/components/forms/submissions-table';
import { useFormDetail } from '@/components/forms/form-detail-context';

export default function FormSubmissionsPage() {
  const { form } = useFormDetail();
  return (
    <AdminOnly>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <SubmissionsTable formId={form.id} />
        </div>
      </div>
    </AdminOnly>
  );
}
