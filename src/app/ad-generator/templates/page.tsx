import { redirect } from 'next/navigation';

/**
 * Disclaimer templates moved into Studio settings, next to OEM Rules — the pair
 * is the compliance config every generated ad has to satisfy.
 */
export default function AdDisclaimersRedirect() {
  redirect('/settings/ad-disclaimers');
}
