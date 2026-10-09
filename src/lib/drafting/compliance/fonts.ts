import { GOOGLE_FONTS } from '@/lib/ad-generator/google-fonts';

/**
 * Font stacks, reduced to the question the house rule asks: is any family in
 * this stack a serif?
 *
 * Pure.
 */

/** System and web-safe serif faces an email might name. */
const SYSTEM_SERIFS = [
  'serif',
  'georgia',
  'times',
  'times new roman',
  'garamond',
  'palatino',
  'palatino linotype',
  'book antiqua',
  'baskerville',
  'cambria',
  'constantia',
  'didot',
  'bodoni',
  'hoefler text',
  'big caslon',
  'charter',
  'iowan old style',
  'rockwell',
  'courier',
  'courier new',
];

const SERIF_FAMILIES = new Set([
  ...SYSTEM_SERIFS,
  ...GOOGLE_FONTS.filter((f) => f.category === 'Serif').map((f) => f.family.toLowerCase()),
]);

/** `'"Helvetica Neue", Arial, sans-serif'` → `['Helvetica Neue', 'Arial', 'sans-serif']`. */
export function fontStack(value: string): string[] {
  return value
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

export function isSerifFamily(family: string): boolean {
  return SERIF_FAMILIES.has(family.trim().toLowerCase());
}

/** The first serif family in a stack — fallbacks count, since a client may land on one. */
export function serifIn(value: string): string | null {
  return fontStack(value).find(isSerifFamily) ?? null;
}
