/**
 * Parse a doc file's frontmatter block.
 *
 * Deliberately a hand-rolled subset rather than a YAML dependency: the fields
 * are a fixed, known list, and the failure mode of a real YAML parser here — a
 * colon inside a title silently restructuring the document — is worse than the
 * failure mode of this one, which is an unrecognized key we ignore.
 *
 *   ---
 *   title: Audiences, Lists & Segments
 *   summary: Building the list a campaign sends to.
 *   sector: studio
 *   category: Audiences
 *   audience: everyone
 *   order: 20
 *   covers:
 *     - src/app/contacts/**
 *     - src/lib/segments/**
 *   ---
 *
 *   # Audiences, Lists & Segments
 *   ...
 *
 * Pure string handling, no imports beyond types — unit-testable without a DB or
 * a filesystem.
 */
import {
  DOC_AUDIENCES,
  DOC_SECTORS,
  type DocAudience,
  type DocSector,
  type DocStatus,
} from './types';

export interface ParsedDoc {
  title: string;
  summary: string;
  sector: DocSector;
  category: string;
  audience: DocAudience;
  status: DocStatus;
  order: number;
  covers: string[];
  body: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ({ ok: true } & ParsedDoc) | ParseFailure;

const FENCE = /^---[ \t]*$/;
/** `key: value`, or `key:` opening a list. */
const KEY_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*:[ \t]*(.*)$/;
/** `  - item` under a key. */
const ITEM_RE = /^[ \t]+-[ \t]+(.*)$/;

/**
 * Split the frontmatter block from the body. Returns null when the file doesn't
 * open with a fence — which is an authoring mistake, not an empty document, so
 * the caller reports it rather than seeding a doc with no metadata.
 */
function split(raw: string): { meta: string[]; body: string } | null {
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || !FENCE.test(lines[i])) return null;

  const start = i + 1;
  let end = -1;
  for (let j = start; j < lines.length; j++) {
    if (FENCE.test(lines[j])) {
      end = j;
      break;
    }
  }
  if (end === -1) return null;

  return {
    meta: lines.slice(start, end),
    body: lines.slice(end + 1).join('\n').trim(),
  };
}

/** Strip a single layer of matching quotes, so `title: "A: B"` works. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseDoc(raw: string): ParseResult {
  const parts = split(raw);
  if (!parts) return { ok: false, error: 'missing or unterminated --- frontmatter block' };

  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let currentList: string | null = null;

  for (const line of parts.meta) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const item = ITEM_RE.exec(line);
    if (item && currentList) {
      lists[currentList].push(unquote(item[1]));
      continue;
    }

    const kv = KEY_RE.exec(line);
    if (!kv) continue;

    const [, key, value] = kv;
    if (value.trim() === '') {
      // A bare `key:` opens a list. If nothing indented follows, it stays empty,
      // which is the same as omitting it.
      currentList = key;
      lists[key] = [];
    } else {
      currentList = null;
      scalars[key] = unquote(value);
    }
  }

  const title = (scalars.title ?? '').trim();
  if (!title) return { ok: false, error: 'title is required' };

  const summary = (scalars.summary ?? '').trim();
  if (!summary) return { ok: false, error: 'summary is required' };

  const sector = (scalars.sector ?? '').trim() as DocSector;
  if (!DOC_SECTORS.includes(sector)) {
    return { ok: false, error: `sector must be one of ${DOC_SECTORS.join(', ')} (got "${scalars.sector ?? ''}")` };
  }

  const category = (scalars.category ?? '').trim();
  if (!category) return { ok: false, error: 'category is required' };

  // Unlike title/sector, a bad audience FALLS BACK rather than failing. Getting
  // this backwards would be the dangerous direction, so the fallback is the
  // closed one: a typo'd audience keeps the article internal.
  const rawAudience = (scalars.audience ?? 'everyone').trim() as DocAudience;
  const audience: DocAudience = DOC_AUDIENCES.includes(rawAudience) ? rawAudience : 'staff';

  const status: DocStatus = (scalars.status ?? '').trim() === 'draft' ? 'draft' : 'published';

  const order = Number.parseInt((scalars.order ?? '').trim(), 10);

  return {
    ok: true,
    title,
    summary,
    sector,
    category,
    audience,
    status,
    order: Number.isFinite(order) ? order : 999,
    covers: (lists.covers ?? []).map((c) => c.trim()).filter(Boolean),
    body: parts.body,
  };
}
