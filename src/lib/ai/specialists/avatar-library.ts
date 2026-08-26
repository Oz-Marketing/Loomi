/**
 * The characters a specialist can wear.
 *
 * A committed manifest rather than a directory scan: these are build-time assets,
 * Next has no filesystem at request time on every host, and a manifest lets each
 * entry carry the accent sampled from its own artwork. Adding a character is a
 * file plus a line here — see scripts/build-agent-avatars.mjs, which derives the
 * square crop and prints the accent to paste in.
 *
 * The set is shared, not per-agent: whoever manages a specialist picks from the
 * same faces as everyone else, so the roster stays visually coherent instead of
 * becoming a dozen unrelated illustration styles.
 */

export interface AvatarCharacter {
  /** Stable id, and the filename stem. */
  slug: string;
  /** The character's own name — a suggestion when picking, never forced. */
  name: string;
  url: string;
  /** Sampled from the character's hair; used for the ring drawn behind them. */
  accent: string;
}

export const AVATAR_LIBRARY: AvatarCharacter[] = [
  { slug: 'vera', name: 'Vera', url: '/agents/library/vera.webp', accent: '#5d44d9' },
];

export function characterByUrl(url: string | null | undefined): AvatarCharacter | null {
  if (!url) return null;
  return AVATAR_LIBRARY.find((c) => c.url === url) ?? null;
}

/**
 * The accent for a chosen portrait, falling back to the identity's own.
 *
 * Kept with the library because the two travel together: pick a different face
 * and the ring behind it should follow, or a violet character ends up in a teal
 * ring that belongs to whoever used to hold that slot.
 */
export function accentForPortrait(url: string | null | undefined, fallback: string): string {
  return characterByUrl(url)?.accent ?? fallback;
}
