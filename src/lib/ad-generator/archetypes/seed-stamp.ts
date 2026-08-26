import type { TemplateDoc } from '../doc-types';
import { designHash } from '../template-sync';

/**
 * TELLING A SEEDED TEMPLATE FROM ONE SOMEBODY HAS WORKED ON.
 *
 * `scripts/seed-archetype-templates.ts` writes template rows from code, and its
 * whole value is that re-running it carries an archetype fix through to the rows
 * already out there. That is also its danger: a designer opens a seeded template,
 * spends an afternoon on it, and the next seed run reverts the lot.
 *
 * So a seeded doc carries the design hash it was written with. On the next run, a
 * row whose current design still matches its stamp has not been touched and is
 * safe to rewrite; one that has moved belongs to whoever moved it.
 *
 * The stamp lives inside `doc.archetype`, which the doc already carries for
 * retheming — no column, no migration. It is excluded from its own hash (set to
 * `''` before hashing) or stamping would change what it is stamping.
 *
 * ── THE DESIGN IS SEEDED; THE CONTENT IS THE DESIGNER'S ──
 *
 * `doc.defaults` — the dealer name, the tagline, the sample vehicle — is excluded
 * from the stamp too, and the script carries the row's own defaults across when it
 * rewrites the design. Typing a dealer name into the CONTENT panel is filling the
 * template in, not redesigning it, and it should not be what cuts a row off from
 * every future archetype fix.
 *
 * Lives here rather than in the script so it can be tested. Silently reverting
 * somebody's work is the worst thing this tool could do, which makes it exactly
 * the logic that should not sit untested in a script nobody imports.
 */

/** The hash of a doc's DESIGN — no stamp, no sample content. */
export function unstampedHash(doc: TemplateDoc): string {
  return designHash(bare(doc));
}

/** The doc reduced to what the seed owns: the design, with no stamp and no content. */
function bare(doc: TemplateDoc): TemplateDoc {
  const withoutContent = { ...doc, defaults: {} };
  if (!doc.archetype) return withoutContent;
  return { ...withoutContent, archetype: { ...doc.archetype, seedHash: '' } };
}

/**
 * The doc, stamped with its own design hash.
 *
 * A doc no archetype produced has nowhere to keep a stamp and is returned
 * unchanged — the script never writes one of those, so this only matters if a
 * caller tries.
 */
export function stampSeeded(doc: TemplateDoc): TemplateDoc {
  if (!doc.archetype) return doc;
  return { ...doc, archetype: { ...doc.archetype, seedHash: unstampedHash(doc) } };
}

/**
 * The content to write when rewriting a seeded row: the archetype's, then
 * whatever the row already had.
 *
 * The row's values win, because a designer typing a real dealer name over a
 * placeholder should not have it replaced by the placeholder on the next run.
 */
export function keepContent(next: TemplateDoc, existing: TemplateDoc | null): TemplateDoc {
  if (!existing?.defaults) return next;
  return { ...next, defaults: { ...next.defaults, ...existing.defaults } };
}

/** The stored doc, when it parses as one. */
export function parseStoredDoc(raw: string): TemplateDoc | null {
  try {
    const v = JSON.parse(raw) as TemplateDoc;
    return v && typeof v === 'object' && Array.isArray(v.elements) ? v : null;
  } catch {
    return null;
  }
}

export interface SeedOwnership {
  /** True when the row must not be rewritten without `--force`. */
  edited: boolean;
  /** Why, in the words the script prints. Empty when it is safe to rewrite. */
  reason: string;
}

/**
 * Whether a stored template row is still the seed's to rewrite.
 *
 * Everything that is not provably untouched counts as edited, including a doc that
 * will not parse and one with no stamp at all. Overwriting something we cannot
 * inspect is how designs disappear, and a row predating stamping might be
 * anybody's work.
 */
export function seedOwnership(raw: string): SeedOwnership {
  const doc = parseStoredDoc(raw);
  if (!doc) return { edited: true, reason: 'its design could not be read' };
  const stamp = doc.archetype?.seedHash;
  if (!stamp) {
    return { edited: true, reason: 'it carries no seed stamp (created or edited before stamping)' };
  }
  return unstampedHash(doc) === stamp
    ? { edited: false, reason: '' }
    : { edited: true, reason: 'its design has been edited since it was seeded' };
}
