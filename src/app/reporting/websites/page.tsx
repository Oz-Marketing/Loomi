import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/page-header';

/**
 * Websites reporting — landing page + form analytics overview.
 *
 * Stub for Phase 1. Phase 2 will wire:
 *   - Aggregate landing-page traffic + conversion charts (sourcing
 *     from `/api/landing-pages/[id]/analytics` rolled up by account)
 *   - Form submission funnel (no analytics endpoint yet — would be
 *     new work)
 */
export default function ReportingWebsitesPage() {
  return (
    <>
      <PageHeader
        icon={GlobeAltIcon}
        title="Website reporting"
        subtitle="Landing page traffic, conversions, and form submissions land here."
      />
      <div className="glass-card mt-8 p-6 text-sm text-[var(--muted-foreground)]">
        Coming next: aggregate LP analytics + form submission funnel. The
        per-page LP analytics already exist in studio — they need to be
        rolled up across an account for this view.
      </div>
    </>
  );
}
