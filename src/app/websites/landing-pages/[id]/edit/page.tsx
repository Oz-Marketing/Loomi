'use client';

import { use } from 'react';
import { LandingPageBuilderPage } from '@/components/landing-pages/landing-page-builder-page';

export default function LandingPageBuilderRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <LandingPageBuilderPage id={id} />;
}
