'use client';

import { AdminOnly } from '@/components/route-guard';
import { FormOverview } from '@/components/forms/form-overview';

export default function FormOverviewPage() {
  return (
    <AdminOnly>
      <FormOverview />
    </AdminOnly>
  );
}
