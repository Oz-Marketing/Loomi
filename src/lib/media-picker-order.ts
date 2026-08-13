import type { RightsStatus } from '@/lib/media-rights';

/**
 * How the media picker orders and filters what it offers.
 *
 * Extracted from the modal so it can be tested: this is the code standing
 * between a lapsed licence and a live ad, and "I clicked around and it looked
 * right" is not the standard that deserves.
 *
 * The rule is respect approval WITHOUT hiding things. An asset that silently
 * vanishes from the picker reads as a bug and sends people looking for another
 * way in; one that's visibly greyed out and sorted last communicates the same
 * constraint and stays auditable.
 */

export interface PickableAsset {
  name: string;
  /** 'draft' | 'approved'. Absent on assets from before the lifecycle existed. */
  status?: string | null;
  rights?: { status: RightsStatus; daysRemaining: number | null } | null;
}

/** Past its licence or campaign date — the case that costs money in live creative. */
export function isOutOfLicence(asset: PickableAsset): boolean {
  return asset.rights?.status === 'expired' || asset.rights?.status === 'lapsed';
}

/**
 * Sort rank: cleared work first, then drafts, then anything out of licence.
 *
 * Out-of-licence outranks draft status deliberately — an approved asset whose
 * licence has since lapsed is MORE dangerous than an honest draft, because the
 * approval badge would otherwise vouch for it.
 */
export function pickerRank(asset: PickableAsset): number {
  if (isOutOfLicence(asset)) return 2;
  return asset.status === 'approved' ? 0 : 1;
}

export interface PickerFilterOptions {
  /** Show only assets cleared for use. */
  approvedOnly: boolean;
  /** Free-text query against the filename. */
  search?: string;
}

export function orderPickerAssets<T extends PickableAsset>(
  assets: T[],
  { approvedOnly, search }: PickerFilterOptions,
): T[] {
  const q = (search ?? '').trim().toLowerCase();

  const kept = assets.filter((a) => {
    // A null/absent status is NOT treated as unapproved. Assets predating the
    // lifecycle column would otherwise disappear the moment someone ticks the
    // box, which looks like data loss rather than a filter.
    if (approvedOnly && a.status && a.status !== 'approved') return false;
    return !q || a.name.toLowerCase().includes(q);
  });

  // Stable within a rank: the server already ordered by recency, and shuffling
  // that would make the picker feel non-deterministic between opens.
  return [...kept].sort((a, b) => pickerRank(a) - pickerRank(b));
}

export function countOutOfLicence(assets: PickableAsset[]): number {
  return assets.filter(isOutOfLicence).length;
}

/**
 * Should "Approved only" start ticked?
 *
 * The flat answer was "no", because approval shipped with the whole library at
 * draft and defaulting it on would have emptied the picker. But leaving it off
 * forever means the compliance gate only protects people who remember to tick a
 * box, which is not a gate.
 *
 * So it's adaptive: on when the scope actually HAS approved work, off when it
 * doesn't. That makes it self-resolving — the moment a first batch is approved
 * the picker starts defaulting to it, with no flag to flip and no day where the
 * picker is empty.
 *
 * An EXPLICIT choice always wins. Once someone unticks it, that's remembered for
 * the session (see the modal's sessionStorage) and this is never consulted again
 * — a default that keeps overriding a person's decision is worse than either
 * fixed answer.
 */
export function defaultApprovedOnly(assets: PickableAsset[]): boolean {
  return assets.some((a) => a.status === 'approved');
}
