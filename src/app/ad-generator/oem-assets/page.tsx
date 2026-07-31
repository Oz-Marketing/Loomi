import { redirect } from 'next/navigation';

/**
 * The guideline library moved into Settings — it's manufacturer reference the whole
 * agency reads, not an ad-building tool.
 *
 * This route stays as a redirect rather than being deleted: the
 * `coop_guideline_changed` notification links here, and notifications already sent
 * keep their link forever.
 */
export default function OemAssetsRedirect() {
  redirect('/settings/coop-guidelines');
}
