'use client';

import { use } from 'react';
import { AdminOnly } from '@/components/route-guard';
import { FlowBuilder } from '@/components/flows/builder/FlowBuilder';

export default function FlowBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AdminOnly>
      <FlowBuilder flowId={id} />
    </AdminOnly>
  );
}
