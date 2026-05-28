import { ReportingPageHeader } from '../_components/page-header';

/**
 * Ads reporting — paid traffic overview.
 *
 * Stub for Phase 1. Ad planning and pacing work continues in studio's
 * `/tools/meta/*` surfaces. This page will surface read-only visuals
 * pulled from the same Meta data — spend, impressions, CTR rolled up
 * by account.
 */
export default function ReportingAdsPage() {
  return (
    <>
      <ReportingPageHeader
        eyebrow="Ads"
        title="Ad reporting"
        subtitle="Meta ad spend, impressions, and CTR — read-only visuals."
      />
      <div className="glass-card mt-8 p-6 text-sm text-[var(--muted-foreground)]">
        Coming next: aggregate Meta performance pulled from the same
        source as the studio Ad Planner / Ad Pacer tools.
      </div>
    </>
  );
}
