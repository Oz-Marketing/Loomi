/**
 * The email-only report has been replaced by "Email & Text Blasts", which
 * covers the same sends plus Loomi email, Loomi text and flows.
 *
 * Kept as a redirect rather than deleted: /reporting/ads/email was the live
 * path for the ported ODT email report and is linked from saved views.
 */
import { redirect } from 'next/navigation';

export default function LegacyEmailReportPage() {
  redirect('/reporting/ads/blasts');
}
