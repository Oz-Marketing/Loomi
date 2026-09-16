import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { parseCsv, importContacts, type ImportMapping } from '@/lib/contacts/import';
import { CONTACT_FIELDS, IGNORE_FIELD, type ContactField } from '@/lib/contacts/normalize';
import { listFieldsForAccount } from '@/lib/services/contact-custom-fields';

// CSV upload pipeline. Three modes:
//
//   ?mode=parse   — parse-only. Returns headers + sample rows +
//                   suggested header→field mapping. No DB writes.
//   ?mode=dryRun  — parse + apply mapping + count. Returns
//                   "would create N, update M, skip K". No writes.
//   ?mode=commit  — parse + apply mapping + upsert. Returns the
//                   actual create/update/skip counts.
//
// The client re-uploads the CSV on each call. Stateless on purpose:
// stashing the parsed file server-side would need Redis or a temp
// table, and dealer CSVs are small (low single-digit MB).
//
// `listId` and `tags` are commit-only — they file the imported contacts
// into a list and tag them. Neither changes the create/update/skip
// counts, so a dry-run ignores both.

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB safety ceiling

// Applied to every row, so a pasted blob here would bloat the whole
// import. The UI offers a pill field, not a paste target; these are a
// backstop, not a design constraint anyone should hit.
const MAX_APPLIED_TAGS = 25;
const MAX_TAG_LENGTH = 64;

type ImportMode = 'parse' | 'dryRun' | 'commit';

function isImportMode(value: string | null): value is ImportMode {
  return value === 'parse' || value === 'dryRun' || value === 'commit';
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.contacts.import');
  if (error) return error;

  const mode = req.nextUrl.searchParams.get('mode');
  if (!isImportMode(mode)) {
    return NextResponse.json(
      { error: "Query param 'mode' must be one of: parse, dryRun, commit" },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: 'Expected multipart form-data with a CSV file' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Form must include a 'file' field with the CSV upload" },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit` },
      { status: 413 },
    );
  }

  const accountKey = String(form.get('accountKey') || '').trim();
  if (!accountKey) {
    return NextResponse.json(
      { error: "Form must include 'accountKey'" },
      { status: 400 },
    );
  }

  // Admins with explicit assignments can only import to their own
  // accounts. Developers / super_admins have unrestricted reach.
  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
    }
  }

  const csvText = await file.text();

  if (mode === 'parse') {
    const preview = parseCsv(csvText);

    // Overlay declared-custom-field aliases on top of the canonical
    // auto-map. Canonical wins — if the CSV column already matched
    // `email`, we don't try to re-route it to a custom field even if
    // someone's blueprint declared "email" as an alias by mistake.
    const merged: Record<string, string> = { ...preview.suggestedMapping };
    const customAutomap = await buildCustomFieldAutomap(accountKey, preview.headers);
    for (const [header, customMapping] of Object.entries(customAutomap)) {
      if (!merged[header]) merged[header] = customMapping;
    }

    return NextResponse.json({
      headers: preview.headers,
      totalRows: preview.totalRows,
      sampleRows: preview.sampleRows,
      suggestedMapping: merged,
      canonicalFields: CONTACT_FIELDS,
    });
  }

  // dryRun / commit both require a mapping payload.
  const mappingRaw = form.get('mapping');
  if (typeof mappingRaw !== 'string') {
    return NextResponse.json(
      { error: "Form must include a JSON 'mapping' field for dryRun / commit" },
      { status: 400 },
    );
  }

  let mapping: ImportMapping;
  try {
    mapping = parseMapping(mappingRaw);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid mapping payload' },
      { status: 400 },
    );
  }

  // Optional list target. When present and committing, every upserted
  // contact gets attached to the list. Validated below so we don't
  // silently drop an unknown id.
  const listIdRaw = form.get('listId');
  const listId = typeof listIdRaw === 'string' && listIdRaw.trim() !== '' ? listIdRaw.trim() : undefined;
  if (listId && mode === 'commit') {
    const { prisma } = await import('@/lib/prisma');
    const list = await prisma.contactList.findUnique({
      where: { id: listId },
      select: { accountKey: true },
    });
    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }
    if (list.accountKey !== accountKey) {
      return NextResponse.json({ error: 'List belongs to a different account' }, { status: 400 });
    }
  }

  // Tags applied to every imported row, on top of a mapped tags column.
  let applyTags: string[];
  try {
    applyTags = parseAppliedTags(form.get('tags'));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid tags payload' },
      { status: 400 },
    );
  }

  // Whether a matched contact keeps its existing field values. The
  // list-upload flow sets this; a plain import that happens to also file
  // into a list does not. Absent, we fall back to the old coupling so an
  // older client keeps its current behavior.
  const preserveRaw = form.get('preserveExisting');
  const preserveExistingOnMatch =
    typeof preserveRaw === 'string' ? preserveRaw === 'true' : Boolean(listId);

  const summary = await importContacts({
    accountKey,
    csvText,
    mapping,
    dryRun: mode === 'dryRun',
    listId: mode === 'commit' ? listId : undefined,
    applyTags: mode === 'commit' ? applyTags : undefined,
    preserveExistingOnMatch,
  });

  return NextResponse.json({ summary });
}

// ── Applied tags ──

/**
 * Read the optional `tags` form field — a JSON string[] of tags to put
 * on every contact the import touches. Absent / empty means none.
 */
function parseAppliedTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("'tags' must be a JSON array of strings");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("'tags' must be a JSON array of strings");
  }

  const tags: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      throw new Error("'tags' must be a JSON array of strings");
    }
    const tag = entry.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag "${tag.slice(0, 20)}…" exceeds ${MAX_TAG_LENGTH} characters`);
    }
    tags.push(tag);
  }

  if (tags.length > MAX_APPLIED_TAGS) {
    throw new Error(`At most ${MAX_APPLIED_TAGS} tags can be applied in one import`);
  }

  return tags;
}

// ── Mapping validation ──

const CANONICAL_SET: ReadonlySet<string> = new Set(CONTACT_FIELDS);

function parseMapping(raw: string): ImportMapping {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Mapping must be a JSON object keyed by CSV header');
  }

  const out: ImportMapping = {};
  for (const [header, target] of Object.entries(parsed)) {
    if (typeof target !== 'string') {
      throw new Error(`Mapping for "${header}" must be a string`);
    }
    if (target === IGNORE_FIELD) {
      out[header] = IGNORE_FIELD;
    } else if (target.startsWith('custom:')) {
      const key = target.slice('custom:'.length).trim();
      if (!key) throw new Error(`Custom field mapping for "${header}" needs a key after "custom:"`);
      out[header] = `custom:${key}`;
    } else if (CANONICAL_SET.has(target)) {
      out[header] = target as ContactField;
    } else {
      throw new Error(`Unknown field "${target}" mapped from header "${header}"`);
    }
  }

  return out;
}

// ── Custom-field alias auto-map ────────────────────────────────

/** Lower-case + strip spaces / dashes / underscores / dots so header
 *  alias matching is forgiving across "Last Service", "last_service",
 *  "last-service". Mirrors the canonical normaliser in normalize.ts. */
function normaliseHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]+/g, '');
}

/**
 * Build `header → "custom:<key>"` suggestions from the account's
 * declared custom-field csvAliases. Returns only the matches —
 * canonical auto-map runs first and wins on collisions.
 *
 * First-match-wins per header so an alias declared on two blueprints
 * doesn't ping-pong. Returns {} when the account has no custom fields.
 */
async function buildCustomFieldAutomap(
  accountKey: string,
  headers: readonly string[],
): Promise<Record<string, string>> {
  const fields = await listFieldsForAccount(accountKey);
  if (fields.length === 0) return {};

  // Pre-index aliases for O(1) lookup. Each entry is the normalised
  // alias → the canonical field key it maps to.
  const aliasIndex = new Map<string, string>();
  for (const field of fields) {
    const aliases = Array.isArray(field.csvAliases) ? field.csvAliases : [];
    for (const alias of aliases) {
      if (typeof alias !== 'string') continue;
      const normalised = normaliseHeaderKey(alias);
      if (!normalised) continue;
      if (!aliasIndex.has(normalised)) aliasIndex.set(normalised, field.key);
    }
    // Also let the custom-field key itself auto-match when the CSV
    // column happens to use the same identifier.
    const keyNormalised = normaliseHeaderKey(field.key);
    if (keyNormalised && !aliasIndex.has(keyNormalised)) {
      aliasIndex.set(keyNormalised, field.key);
    }
  }

  const out: Record<string, string> = {};
  for (const header of headers) {
    const key = normaliseHeaderKey(header);
    if (!key) continue;
    const customKey = aliasIndex.get(key);
    if (customKey) out[header] = `custom:${customKey}`;
  }
  return out;
}
