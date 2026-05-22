/**
 * Stable color assignment for tag names.
 *
 * A small palette of muted, tasteful tag colors. Each tag name hashes to one
 * of these so the same tag always shows the same color across the app.
 */

export interface TagColor {
  /** Tailwind-compatible classes for the tag chip background + text + ring. */
  className: string;
  /** Bare color name for places that need to compose styles manually. */
  name: string;
}

const PALETTE: TagColor[] = [
  { name: 'rose',    className: 'bg-rose-500/10 text-rose-400 ring-1 ring-inset ring-rose-500/20' },
  { name: 'amber',   className: 'bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20' },
  { name: 'emerald', className: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/20' },
  { name: 'teal',    className: 'bg-teal-500/10 text-teal-400 ring-1 ring-inset ring-teal-500/20' },
  { name: 'sky',     className: 'bg-sky-500/10 text-sky-400 ring-1 ring-inset ring-sky-500/20' },
  { name: 'indigo',  className: 'bg-indigo-500/10 text-indigo-400 ring-1 ring-inset ring-indigo-500/20' },
  { name: 'violet',  className: 'bg-violet-500/10 text-violet-400 ring-1 ring-inset ring-violet-500/20' },
  { name: 'fuchsia', className: 'bg-fuchsia-500/10 text-fuchsia-400 ring-1 ring-inset ring-fuchsia-500/20' },
  { name: 'orange',  className: 'bg-orange-500/10 text-orange-400 ring-1 ring-inset ring-orange-500/20' },
  { name: 'lime',    className: 'bg-lime-500/10 text-lime-400 ring-1 ring-inset ring-lime-500/20' },
];

function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return Math.abs(h);
}

export function getTagColor(tagName: string): TagColor {
  const normalized = tagName.trim().toLowerCase();
  if (!normalized) return PALETTE[0];
  return PALETTE[hash(normalized) % PALETTE.length];
}
