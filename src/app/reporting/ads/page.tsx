import { redirect } from 'next/navigation';
import { LIVE_REPORTS } from './_components/reports-config';

/**
 * Digital Ads index. Navigation happens via the sidebar's Digital Ads
 * dropdown, so hitting /reporting/ads directly just lands you on the first
 * live platform report.
 */
export default function DigitalAdsIndex() {
  redirect(`/ads/${LIVE_REPORTS[0]?.key ?? 'meta'}`);
}
