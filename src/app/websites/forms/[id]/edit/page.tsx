'use client';

import { AdminOnly } from '@/components/route-guard';
import { FormBuilderPage } from '@/components/forms/form-builder-page';

export default function FormBuilderTabPage() {
  return (
    <AdminOnly>
      <FormBuilderPage />
    </AdminOnly>
  );
}
