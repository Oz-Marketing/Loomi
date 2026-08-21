import { redirect } from 'next/navigation';

/**
 * OEM compliance rules moved into Studio settings, next to Disclaimers.
 */
export default function AdOemRulesRedirect() {
  redirect('/settings/ad-oem-rules');
}
