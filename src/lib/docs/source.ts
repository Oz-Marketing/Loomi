/**
 * Read the doc library off disk.
 *
 * Articles live at `content/docs/<sector>/<slug>.md` and the path IS the
 * identity: the directory is a sanity check against the frontmatter's `sector`,
 * and the filename is the slug and the URL. Renaming a file therefore breaks its
 * links, which is the correct amount of friction — a doc URL is something people
 * paste into Slack.
 *
 * Node-only (`node:fs`). Imported by `scripts/seed-docs.ts` and
 * `scripts/docs-drift.ts`, never by a React component.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseDoc, type ParsedDoc } from './frontmatter';
import { DOC_SECTORS, type DocSector } from './types';

export interface DocFile extends ParsedDoc {
  /** `studio/audiences.md` — stable across machines, so it works as a DB key. */
  sourceKey: string;
  slug: string;
  /** sha256 of the raw file, so an unchanged file is a no-op on re-seed. */
  hash: string;
}

export interface DocLoadResult {
  files: DocFile[];
  /** Files that failed to parse, so the seeder can report rather than skip silently. */
  errors: { sourceKey: string; error: string }[];
}

export function docsRoot(): string {
  return resolve(process.cwd(), 'content', 'docs');
}

function listMarkdown(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith('.md')).sort();
}

/**
 * A slug is lowercase kebab, no path segments. Enforced rather than sanitized:
 * a file named `Ad Generator.md` should be a loud failure at seed time, not a
 * quietly mangled URL that nobody can guess.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadDocFiles(root = docsRoot()): DocLoadResult {
  const files: DocFile[] = [];
  const errors: { sourceKey: string; error: string }[] = [];

  for (const sector of DOC_SECTORS) {
    const dir = join(root, sector);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue; // a sector with no articles yet
    }

    for (const name of listMarkdown(dir)) {
      const sourceKey = `${sector}/${name}`;
      const slug = name.replace(/\.md$/, '');

      if (!SLUG_RE.test(slug)) {
        errors.push({ sourceKey, error: `filename "${name}" is not a lowercase-kebab slug` });
        continue;
      }

      const raw = readFileSync(join(dir, name), 'utf-8');
      const parsed = parseDoc(raw);
      if (!parsed.ok) {
        errors.push({ sourceKey, error: parsed.error });
        continue;
      }

      // The directory wins arguments with the frontmatter. Both are easy to get
      // wrong in a copy-paste; only one of them decides where the file lives.
      if (parsed.sector !== (sector as DocSector)) {
        errors.push({
          sourceKey,
          error: `sector "${parsed.sector}" does not match its directory "${sector}"`,
        });
        continue;
      }

      files.push({
        ...parsed,
        sourceKey,
        slug,
        hash: createHash('sha256').update(raw).digest('hex'),
      });
    }
  }

  const seen = new Map<string, string>();
  for (const file of files) {
    const prior = seen.get(file.slug);
    // Slugs are the URL, so two sectors can't both own `overview.md`.
    if (prior) errors.push({ sourceKey: file.sourceKey, error: `slug "${file.slug}" already used by ${prior}` });
    else seen.set(file.slug, file.sourceKey);
  }

  return { files: files.filter((f) => !errors.some((e) => e.sourceKey === f.sourceKey)), errors };
}
