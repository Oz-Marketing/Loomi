'use client';

/**
 * Studio home (admin / global). Renders the same `StudioHome` as the
 * sub-account dashboard does — analytics moved to `/reporting`, so
 * both views are now creative-tool landing pages.
 */
import { StudioHome } from '@/components/studio-home';

export default function DashboardPage() {
  return <StudioHome />;
}
