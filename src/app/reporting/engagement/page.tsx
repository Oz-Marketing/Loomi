/**
 * Engagement reporting has moved.
 *
 * It is now Digital Ads → "Email & Text Blasts" (/reporting/ads/blasts), which
 * carries what this page carried plus Loomi text sends and the email history
 * from the provider used before Loomi. Two entries for one subject meant two
 * places to look and two sets of numbers to reconcile.
 *
 * This redirect stays because the old path is in bookmarks, saved links and at
 * least one PDF export footer. A 404 here would read as the reporting being
 * gone rather than moved.
 */
import { redirect } from 'next/navigation';

export default function ReportingEngagementPage() {
  redirect('/reporting/ads/blasts');
}
