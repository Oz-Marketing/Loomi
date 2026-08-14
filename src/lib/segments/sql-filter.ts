// FilterDefinition → SQL, for segment resolution that runs in the
// database instead of in a browser tab.
//
// WHY: segment membership used to be computed by fetching contacts and
// filtering them in JS. The fetch is capped (MAX_FETCH_ALL = 5000), so
// on any account past that cap every segment count in the product was
// a count of the first 5,000 rows — silently wrong, and unusable as the
// basis for an ad-platform audience.
//
// SCOPE: this translates the conditions that map cleanly onto Contact
// COLUMNS — text, dates, the tags jsonb array, and the engagement
// rollups. It deliberately refuses one family:
//
//   - custom fields, which live as untyped strings inside a jsonb blob
//     where the JS engine's coercion rules (Number(), Date(), comma
//     splitting) have no faithful SQL equivalent
//
// (Messaging fields used to be refused too, because they were read-time
// aggregates over EmailEvent/SmsEvent. They're denormalised columns now,
// so engagement segments — among the most common — take the fast path.)
//
// A definition touching that is reported as untranslatable and the
// resolver falls back to streaming every contact through the JS engine
// (see resolve.ts). That fallback is uncapped, so correctness never
// depends on the translation being complete — only speed does. The rule
// is: translate only what can be translated EXACTLY, and be honest
// about the rest. A fast path that returns subtly different rows than
// the slow path is worse than no fast path.

import { Prisma } from '@prisma/client';
import {
  addFilterDays,
  endOfFilterDay,
  parseFilterDate,
  startOfFilterDay,
} from '@/lib/smart-list-engine';
import { SEGMENT_REF_FIELD } from './constants';
import {
  FILTERABLE_FIELDS,
  type FieldDefinition,
  type FilterCondition,
  type FilterDefinition,
} from '@/lib/smart-list-types';

const TRUE = Prisma.sql`TRUE`;
const FALSE = Prisma.sql`FALSE`;

/** Built-in fields that map to a real Contact column, by type. */
const TEXT_COLUMNS = new Set(
  FILTERABLE_FIELDS.filter((f) => f.type === 'text').map((f) => f.key),
);
const DATE_COLUMNS = new Set(
  FILTERABLE_FIELDS.filter((f) => f.type === 'date').map((f) => f.key),
);
const BOOLEAN_COLUMNS = new Set(
  FILTERABLE_FIELDS.filter((f) => f.type === 'boolean').map((f) => f.key),
);
const NUMERIC_TEXT_COLUMNS = new Set(
  FILTERABLE_FIELDS.filter((f) => f.type === 'numeric_text').map((f) => f.key),
);
// Real numeric columns (history rollups) — no cast guard needed, unlike
// numeric_text where the value is a string that may not be a number.
const NUMBER_COLUMNS = new Set(
  FILTERABLE_FIELDS.filter((f) => f.type === 'number').map((f) => f.key),
);

const NUMBER_OPERATORS = new Set([
  'num_equals',
  'num_not_equals',
  'num_gt',
  'num_lt',
  'num_gte',
  'num_lte',
  'num_between',
]);

// The legacy engagement booleans aren't stored — they're "the matching
// timestamp is set". Same derivation serializeContact applies, so the
// two paths agree.
// Opt-out flags live inside the `dnd` jsonb cell rather than in their
// own columns.
const DND_JSON_KEY: Record<string, string> = {
  dndEmail: 'email',
  dndSms: 'sms',
};

const BOOLEAN_BACKING_COLUMN: Record<string, string> = {
  hasReceivedMessage: 'lastMessageAt',
  hasReceivedEmail: 'lastEmailDeliveredAt',
  hasReceivedSms: 'lastSmsAt',
  hasOpenedEmail: 'lastEmailOpenedAt',
  hasClickedEmail: 'lastEmailClickedAt',
};

// A handful of filter keys don't match their column name.
const COLUMN_OVERRIDES: Record<string, string> = {
  lastMessageDate: 'lastMessageAt',
};

function columnName(field: string): string {
  return COLUMN_OVERRIDES[field] ?? field;
}

export interface SqlTranslation {
  /** Boolean SQL over a `"Contact"` row, or null when some condition
   *  couldn't be translated exactly. */
  where: Prisma.Sql | null;
  /** Field keys that forced the fallback — surfaced for logging and for
   *  the `strategy` the API reports back. */
  untranslatable: string[];
}

/**
 * Translate a whole definition. Returns `where: null` if ANY condition
 * is untranslatable — partial translation would mean running a filter
 * that's narrower or wider than the one the user built.
 */
export function translateDefinitionToSql(
  definition: FilterDefinition,
  fields: FieldDefinition[],
  /** Referenced segment definitions, for `in_segment` composition. */
  refs?: Map<string, FilterDefinition>,
): SqlTranslation {
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  const untranslatable: string[] = [];
  const where = translateDefinition(definition, fieldMap, refs, untranslatable, 0);

  if (untranslatable.length > 0) {
    return { where: null, untranslatable: [...new Set(untranslatable)] };
  }
  return { where, untranslatable };
}

/** Recursive worker — a referenced segment is inlined as a nested
 *  boolean expression over the same `"Contact"` row. */
function translateDefinition(
  definition: FilterDefinition,
  fieldMap: Map<string, FieldDefinition>,
  refs: Map<string, FilterDefinition> | undefined,
  untranslatable: string[],
  depth: number,
): Prisma.Sql {
  if (!definition.groups?.length) return FALSE;
  if (depth > 5) {
    untranslatable.push(SEGMENT_REF_FIELD);
    return FALSE;
  }

  const groupSql: Prisma.Sql[] = [];
  for (const group of definition.groups) {
    if (!group?.conditions?.length) {
      groupSql.push(FALSE);
      continue;
    }
    const conditionSql: Prisma.Sql[] = [];
    for (const condition of group.conditions) {
      const translated = translateCondition(
        condition,
        fieldMap,
        refs,
        untranslatable,
        depth,
      );
      if (translated === null) {
        untranslatable.push(condition.field);
        continue;
      }
      conditionSql.push(translated);
    }
    if (untranslatable.length > 0) continue;
    groupSql.push(joinBool(conditionSql, group.logic));
  }

  return joinBool(groupSql, definition.logic);
}

function joinBool(parts: Prisma.Sql[], logic: 'AND' | 'OR'): Prisma.Sql {
  if (parts.length === 0) return FALSE;
  const sep = logic === 'OR' ? ' OR ' : ' AND ';
  return Prisma.sql`(${Prisma.join(parts, sep)})`;
}

/** One condition → SQL, or null when it can't be translated exactly. */
function translateCondition(
  condition: FilterCondition,
  fieldMap: Map<string, FieldDefinition>,
  refs: Map<string, FilterDefinition> | undefined,
  untranslatable: string[],
  depth: number,
): Prisma.Sql | null {
  const { field, operator, value, value2 } = condition;
  const def = fieldMap.get(field);

  // Segment composition inlines the referenced definition rather than
  // materialising its members — see refs.ts.
  if (operator === 'in_segment' || operator === 'not_in_segment') {
    const referenced = refs?.get(value?.trim() ?? '');
    // Fails closed, matching the engine: an unresolved reference must
    // never widen the audience.
    if (!referenced) return FALSE;
    const inner = translateDefinition(
      referenced,
      fieldMap,
      refs,
      untranslatable,
      depth + 1,
    );
    // COALESCE before negating. SQL's NOT is three-valued: any inner
    // comparison against a NULL column yields NULL, and NOT NULL is
    // NULL — so the row would be dropped rather than matched. The JS
    // engine treats NULL as '' and returns a plain boolean, so a bare
    // `NOT (inner)` silently excludes every contact whose referenced
    // segment touched a column they leave empty.
    return operator === 'in_segment'
      ? inner
      : Prisma.sql`NOT COALESCE((${inner}), FALSE)`;
  }

  // Unknown field: the engine fails closed on it, so match nothing.
  if (!def) return FALSE;
  // Custom fields live in a jsonb blob — see the file header.
  if (def.isCustom) return null;

  // Same completeness rule the engine applies before evaluating.
  if (!hasRequiredValues(operator, value, value2)) return FALSE;

  if (field === 'tags' && def.type === 'tags') {
    return translateTags(operator, value);
  }
  if (field === 'listIds') {
    return translateListMembership(operator, value);
  }
  if (BOOLEAN_COLUMNS.has(field) && def.type === 'boolean') {
    return translateEngagementBoolean(field, operator);
  }
  if (DATE_COLUMNS.has(field) && def.type === 'date') {
    return translateDate(field, operator, value, value2);
  }
  if (TEXT_COLUMNS.has(field) && def.type === 'text') {
    return translateText(field, operator, value);
  }
  if (NUMBER_COLUMNS.has(field) && def.type === 'number') {
    return translateNumber(field, operator, value, value2);
  }
  if (NUMERIC_TEXT_COLUMNS.has(field) && def.type === 'numeric_text') {
    return NUMBER_OPERATORS.has(operator)
      ? translateNumericText(field, operator, value, value2)
      : translateText(field, operator, value);
  }
  // A built-in whose declared type no longer matches its column (e.g. a
  // field re-typed in the catalogue) — don't guess.
  return null;
}

// Duplicated rather than imported to keep this module free of a cycle
// back through the engine's evaluation path; kept in lockstep by
// sql-filter.test.ts.
function hasRequiredValues(
  operator: string,
  value: string | undefined,
  value2: string | undefined,
): boolean {
  if (['is_empty', 'is_not_empty', 'overdue', 'is_true', 'is_false'].includes(operator)) {
    return true;
  }
  if (!value?.trim()) return false;
  if (operator === 'between' || operator === 'num_between') return !!value2?.trim();
  return true;
}

// ── Text ────────────────────────────────────────────────────────
//
// The engine trims the column value and lowercases both sides, and does
// NOT trim the comparison value (see evaluateTextCondition). `btrim` +
// `lower` reproduce that exactly. NULL is '' to the engine, which is why
// the negative operators have to explicitly re-admit NULL rows: plain
// `NOT (col ILIKE …)` is NULL for a NULL column and would silently drop
// every contact missing that field.

/**
 * The lifetime engagement booleans, expressed against their backing
 * timestamp — `hasOpenedEmail is_true` becomes `lastEmailOpenedAt IS NOT
 * NULL`, exactly the derivation serializeContact performs.
 */
function translateEngagementBoolean(
  field: string,
  operator: string,
): Prisma.Sql | null {
  const dndKey = DND_JSON_KEY[field];
  if (dndKey) {
    // Matches serializeContact's readDndFlag: a JSON true, or the string
    // "true" for rows written by an older path.
    const expr = Prisma.raw(`("Contact"."dnd" ->> '${dndKey}')`);
    return operator === 'is_true'
      ? Prisma.sql`${expr} = 'true'`
      : operator === 'is_false'
        ? Prisma.sql`(${expr} IS NULL OR ${expr} <> 'true')`
        : null;
  }

  const backing = BOOLEAN_BACKING_COLUMN[field];
  if (!backing) return null;
  const col = Prisma.raw(`"Contact"."${backing}"`);
  switch (operator) {
    case 'is_true':
      return Prisma.sql`${col} IS NOT NULL`;
    case 'is_false':
      return Prisma.sql`${col} IS NULL`;
    default:
      return null;
  }
}

/**
 * Numeric comparison over a text column (vehicle year / mileage).
 *
 * The cast has to be guarded: `'not a number'::numeric` raises, which
 * would fail the whole query rather than just excluding the row. The
 * regex below is the SQL twin of the engine's NUMERIC_TEXT pattern —
 * plain decimals, commas stripped first — so both sides agree on exactly
 * which stored strings count as numbers. Rows that don't match are NULL
 * and therefore never selected, matching the engine returning false when
 * parseNumeric yields null.
 */
function numericExpr(field: string): Prisma.Sql {
  const col = `btrim(replace("Contact"."${columnName(field)}", ',', ''))`;
  return Prisma.raw(
    `(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::numeric END)`,
  );
}

/**
 * Comparison against a genuine numeric column. The engine reaches these
 * through String(raw) → parseNumeric, which round-trips exactly for
 * integers and finite floats, so a direct SQL comparison agrees.
 */
function translateNumber(
  field: string,
  operator: string,
  value: string,
  value2: string | undefined,
): Prisma.Sql | null {
  const col = Prisma.raw(`"Contact"."${columnName(field)}"`);
  const target = parseNumericValue(value);

  switch (operator) {
    case 'is_empty':
      return Prisma.sql`${col} IS NULL`;
    case 'is_not_empty':
      return Prisma.sql`${col} IS NOT NULL`;
    default:
      break;
  }
  if (target === null) return FALSE;

  switch (operator) {
    case 'num_equals':
      return Prisma.sql`${col} = ${target}`;
    case 'num_not_equals':
      return Prisma.sql`(${col} IS NOT NULL AND ${col} <> ${target})`;
    case 'num_gt':
      return Prisma.sql`${col} > ${target}`;
    case 'num_lt':
      return Prisma.sql`${col} < ${target}`;
    case 'num_gte':
      return Prisma.sql`${col} >= ${target}`;
    case 'num_lte':
      return Prisma.sql`${col} <= ${target}`;
    case 'num_between': {
      const upper = parseNumericValue(value2);
      if (upper === null) return FALSE;
      return Prisma.sql`(${col} >= ${target} AND ${col} <= ${upper})`;
    }
    default:
      return null;
  }
}

function translateNumericText(
  field: string,
  operator: string,
  value: string,
  value2: string | undefined,
): Prisma.Sql | null {
  const expr = numericExpr(field);
  const target = parseNumericValue(value);
  if (target === null) return FALSE;

  switch (operator) {
    case 'num_equals':
      return Prisma.sql`${expr} = ${target}`;
    case 'num_not_equals':
      // The engine requires a parsed value on BOTH sides for
      // num_not_equals, so a non-numeric cell doesn't match.
      return Prisma.sql`${expr} IS NOT NULL AND ${expr} <> ${target}`;
    case 'num_gt':
      return Prisma.sql`${expr} > ${target}`;
    case 'num_lt':
      return Prisma.sql`${expr} < ${target}`;
    case 'num_gte':
      return Prisma.sql`${expr} >= ${target}`;
    case 'num_lte':
      return Prisma.sql`${expr} <= ${target}`;
    case 'num_between': {
      const upper = parseNumericValue(value2);
      if (upper === null) return FALSE;
      return Prisma.sql`(${expr} >= ${target} AND ${expr} <= ${upper})`;
    }
    default:
      return null;
  }
}

/** Same restricted grammar the engine applies to the comparison value. */
function parseNumericValue(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function textColumn(field: string): Prisma.Sql {
  // Field keys come from FILTERABLE_FIELDS, never from user input, and
  // are validated against the catalogue above — but build the identifier
  // through Prisma.raw only after that check, never from a raw string.
  //
  // `fullName` is DERIVED, not just read: serializeContact falls back to
  // "firstName lastName" when the column is null/empty, and that's the
  // value every existing Full Name segment was built against. Reading
  // the bare column here would silently change those segments' meaning
  // for every contact whose fullName was never populated.
  if (field === 'fullName') {
    return Prisma.raw(`lower(btrim(COALESCE(
      NULLIF(btrim("Contact"."fullName"), ''),
      btrim(CONCAT_WS(' ', "Contact"."firstName", "Contact"."lastName"))
    )))`);
  }
  return Prisma.raw(`lower(btrim("Contact"."${columnName(field)}"))`);
}

function translateText(
  field: string,
  operator: string,
  value: string,
): Prisma.Sql | null {
  const col = textColumn(field);
  const target = value.toLowerCase();
  const like = `%${escapeLike(target)}%`;

  switch (operator) {
    case 'contains':
      return Prisma.sql`${col} LIKE ${like} ESCAPE '\\'`;
    case 'not_contains':
      return Prisma.sql`(${col} IS NULL OR ${col} NOT LIKE ${like} ESCAPE '\\')`;
    case 'equals':
      return Prisma.sql`${col} = ${target}`;
    case 'not_equals':
      return Prisma.sql`(${col} IS NULL OR ${col} <> ${target})`;
    case 'is_empty':
      return Prisma.sql`(${col} IS NULL OR ${col} = '')`;
    case 'is_not_empty':
      return Prisma.sql`(${col} IS NOT NULL AND ${col} <> '')`;
    default:
      return null;
  }
}

/** `%` and `_` are wildcards to SQL but literal characters to the JS
 *  engine's `String.includes`, so they have to be escaped or a search
 *  for "50%" would match far more than it should. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ── Dates ───────────────────────────────────────────────────────
//
// Bounds are computed with the engine's own helpers so relative windows
// ("within the last 30 days") resolve to the same instants on both
// paths. Comparisons against a NULL column yield NULL → the row isn't
// selected, which matches the engine returning false when it can't
// parse a date.

function translateDate(
  field: string,
  operator: string,
  value: string,
  value2: string | undefined,
): Prisma.Sql | null {
  const col = Prisma.raw(`"Contact"."${columnName(field)}"`);
  const todayStart = startOfFilterDay(new Date());

  switch (operator) {
    case 'is_empty':
      return Prisma.sql`${col} IS NULL`;
    case 'is_not_empty':
      return Prisma.sql`${col} IS NOT NULL`;
    case 'overdue':
      return Prisma.sql`${col} < ${todayStart}`;
    case 'before': {
      const bound = parseFilterDate(value);
      return bound ? Prisma.sql`${col} < ${bound}` : FALSE;
    }
    case 'after': {
      const bound = parseFilterDate(value);
      return bound ? Prisma.sql`${col} > ${bound}` : FALSE;
    }
    case 'between': {
      const lower = parseFilterDate(value);
      const upper = parseFilterDate(value2);
      if (!lower || !upper) return FALSE;
      return Prisma.sql`(${col} >= ${lower} AND ${col} <= ${upper})`;
    }
    case 'within_days': {
      const days = parseDays(value);
      if (days === null) return FALSE;
      const upper = endOfFilterDay(addFilterDays(todayStart, days));
      return Prisma.sql`(${col} >= ${todayStart} AND ${col} <= ${upper})`;
    }
    case 'within_last_days': {
      const days = parseDays(value);
      if (days === null) return FALSE;
      const lower = addFilterDays(todayStart, -days);
      const upper = endOfFilterDay(todayStart);
      return Prisma.sql`(${col} >= ${lower} AND ${col} <= ${upper})`;
    }
    case 'more_than_days_ago': {
      const days = parseDays(value);
      if (days === null) return FALSE;
      // The engine compares startOfDay(row) < cutoff where cutoff is a
      // midnight boundary; for a midnight cutoff that's equivalent to
      // comparing the raw timestamp.
      return Prisma.sql`${col} < ${addFilterDays(todayStart, -days)}`;
    }
    default:
      return null;
  }
}

function parseDays(value: string): number | null {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}



// ── Tags ────────────────────────────────────────────────────────
//
// `tags` is a jsonb array of strings and the engine matches it
// case-insensitively, which rules out jsonb containment (`@>` is exact).
// Unnesting with jsonb_array_elements_text and lowering each element is
// the faithful translation. Every row is guarded on
// `jsonb_typeof = 'array'` because that function errors — not returns
// empty — on a non-array value.

function tagElements(): Prisma.Sql {
  return Prisma.sql`
    SELECT lower(elem) AS tag
    FROM jsonb_array_elements_text("Contact"."tags") AS elem
    WHERE jsonb_typeof("Contact"."tags") = 'array'`;
}

/**
 * Static list membership, via the join table. Same operator family and
 * same case-folding as tags — list ids are lowercase cuids, so lowering
 * both sides is a no-op that guarantees the two engines can't drift.
 */
function translateListMembership(
  operator: string,
  value: string,
): Prisma.Sql | null {
  const targets = parseCsvLower(value);
  const memberships = (extra: Prisma.Sql) => Prisma.sql`
    SELECT 1 FROM "ContactListMembership" m
    WHERE m."contactId" = "Contact"."id" ${extra}`;

  switch (operator) {
    case 'is_empty':
      return Prisma.sql`NOT EXISTS (${memberships(Prisma.empty)})`;
    case 'is_not_empty':
      return Prisma.sql`EXISTS (${memberships(Prisma.empty)})`;
    case 'includes_any':
      if (targets.length === 0) return FALSE;
      return Prisma.sql`EXISTS (${memberships(Prisma.sql`AND lower(m."listId") = ANY(${targets}::text[])`)})`;
    case 'excludes':
      if (targets.length === 0) return TRUE;
      return Prisma.sql`NOT EXISTS (${memberships(Prisma.sql`AND lower(m."listId") = ANY(${targets}::text[])`)})`;
    case 'includes_all': {
      if (targets.length === 0) return TRUE;
      return Prisma.sql`(
        SELECT COUNT(DISTINCT lower(m."listId")) FROM "ContactListMembership" m
        WHERE m."contactId" = "Contact"."id"
          AND lower(m."listId") = ANY(${targets}::text[])
      ) = ${targets.length}`;
    }
    default:
      return null;
  }
}

function parseCsvLower(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function translateTags(operator: string, value: string): Prisma.Sql | null {
  const targets = value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  switch (operator) {
    case 'is_empty':
      return Prisma.sql`(jsonb_typeof("Contact"."tags") <> 'array' OR jsonb_array_length("Contact"."tags") = 0)`;
    case 'is_not_empty':
      return Prisma.sql`(jsonb_typeof("Contact"."tags") = 'array' AND jsonb_array_length("Contact"."tags") > 0)`;
    case 'includes_any':
      if (targets.length === 0) return FALSE;
      return Prisma.sql`EXISTS (${tagElements()} AND lower(elem) = ANY(${targets}::text[]))`;
    case 'excludes':
      // The engine returns true when NONE of the targets are present —
      // including for a contact with no tags at all.
      if (targets.length === 0) return TRUE;
      return Prisma.sql`NOT EXISTS (${tagElements()} AND lower(elem) = ANY(${targets}::text[]))`;
    case 'includes_all': {
      if (targets.length === 0) return TRUE;
      return Prisma.sql`(
        SELECT COUNT(DISTINCT tag) FROM (${tagElements()}) AS tags_of_contact
        WHERE tag = ANY(${targets}::text[])
      ) = ${targets.length}`;
    }
    default:
      return null;
  }
}
