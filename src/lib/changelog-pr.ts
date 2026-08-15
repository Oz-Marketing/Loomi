/**
 * Parse changelog entries out of a pull-request description.
 *
 * The commit log is written for us, not for users — "drop an import left unused
 * by the field-prefs rework" is not a release note. So entries are authored
 * deliberately, in a `## Changelog` block in the PR body, and everything else
 * about the merge is ignored. A PR with no block produces no entry, which is the
 * right default: most merges are not worth telling anyone about.
 *
 * Format (everything but `title` and the body is optional):
 *
 *   ## Changelog
 *   type: feature
 *   audience: everyone
 *   title: Bulk download for the Asset Library
 *
 *   Select any number of assets and download them as one zip. Large
 *   selections stream, so there's no wait while a file is assembled.
 *
 * Multiple entries in one PR: separate them with a line of `---`.
 *
 * Pure string handling, no imports — so it can be unit-tested without a DB.
 */

import {
  ENTRY_TYPES,
  AUDIENCES,
  type EntryType,
  type ChangelogAudience,
} from '@/lib/changelog';

export interface ParsedEntry {
  title: string;
  content: string;
  type: EntryType;
  audience: ChangelogAudience;
}

/** Heading that opens the block, at any markdown level (`#` … `######`). */
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+changelog[ \t]*:?[ \t]*$/i;
/** Any other heading — ends the block. */
const ANY_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+\S/;
/** Entry separator inside the block. */
const SEPARATOR_RE = /^[ \t]*-{3,}[ \t]*$/;
/** `key: value` metadata line. */
const META_RE = /^[ \t]*(type|audience|title)[ \t]*:[ \t]*(.*)$/i;

/**
 * Pull the raw text of the `## Changelog` section out of a PR body.
 * Returns null when there's no such heading.
 */
function extractBlock(prBody: string): string | null {
  // PR templates carry their instructions in HTML comments. Left in, a
  // commented-out example block would be parsed as a real entry.
  const body = prBody.replace(/<!--[\s\S]*?-->/g, '');
  const lines = body.split(/\r?\n/);

  const start = lines.findIndex((l) => HEADING_RE.test(l));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => ANY_HEADING_RE.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

function coerceType(value: string | undefined): EntryType {
  const v = (value ?? '').trim().toLowerCase();
  return (ENTRY_TYPES as string[]).includes(v) ? (v as EntryType) : 'improvement';
}

function coerceAudience(value: string | undefined): ChangelogAudience {
  const v = (value ?? '').trim().toLowerCase();
  return (AUDIENCES as string[]).includes(v) ? (v as ChangelogAudience) : 'everyone';
}

/**
 * Parse one `---`-separated chunk. Metadata lines come first; everything after
 * them is the body. Returns null if the chunk has no title or no body — a
 * half-filled template should produce nothing rather than an empty entry that
 * someone then has to notice and delete.
 */
function parseChunk(chunk: string): ParsedEntry | null {
  const lines = chunk.split('\n');
  const meta: Record<string, string> = {};

  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      // A blank line before any metadata is just padding above the block.
      if (Object.keys(meta).length === 0) continue;
      i++;
      break;
    }
    const m = line.match(META_RE);
    if (!m) break;
    meta[m[1].toLowerCase()] = m[2].trim();
  }

  const title = meta.title?.trim();
  const content = lines.slice(i).join('\n').trim();
  if (!title || !content) return null;

  return {
    title,
    content,
    type: coerceType(meta.type),
    audience: coerceAudience(meta.audience),
  };
}

/**
 * Extract every changelog entry declared in a PR body. Returns an empty array
 * when the PR has no `## Changelog` block, or the block is empty / unfilled.
 */
export function parseChangelogFromPrBody(prBody: string | null | undefined): ParsedEntry[] {
  if (!prBody) return [];

  const block = extractBlock(prBody);
  if (block === null || block.trim() === '') return [];

  return block
    .split('\n')
    .reduce<string[][]>(
      (chunks, line) => {
        if (SEPARATOR_RE.test(line)) chunks.push([]);
        else chunks[chunks.length - 1].push(line);
        return chunks;
      },
      [[]],
    )
    .map((lines) => parseChunk(lines.join('\n')))
    .filter((e): e is ParsedEntry => e !== null);
}
