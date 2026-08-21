import { redirect } from 'next/navigation';

/**
 * The size library moved into Studio settings — it's the list every ad in the
 * sector is designed against, not a screen the generator owns.
 *
 * The route stays as a redirect rather than being deleted: the builder's "manage
 * sizes" link and any bookmark from the old cog menu still point here.
 */
export default function AdSizesRedirect() {
  redirect('/settings/ad-sizes');
}
