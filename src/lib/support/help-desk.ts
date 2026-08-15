/**
 * Shared contract for the in-app help desk (`/support`).
 *
 * Submissions land as items on the Oz Marketing "🤜 Oz Tools Help Desk"
 * monday.com board — the same board the public monday form writes to, so
 * in-app reports sit in one triage queue beside everything else the team
 * receives.
 *
 *   https://oz-marketing.monday.com/boards/9778139049
 *
 * This module is CLIENT-SAFE on purpose: the page renders its dropdowns from
 * the same option lists the server maps to monday columns, so the two can't
 * drift into a submission monday silently drops. Anything needing the API
 * token lives in `./monday.ts`.
 *
 * Column ids are opaque monday identifiers (`dropdown_mktm2xjc` etc.) — they're
 * stable for the life of the column but meaningless to read, hence the map.
 */

/** Board + group the in-app help desk writes to. Overridable via env. */
export const HELP_DESK_BOARD_ID = '9778139049';
/** "New Requests" — the board's top group, where untriaged work belongs. */
export const HELP_DESK_GROUP_ID = 'topics';

/** monday column ids on the help desk board, by role. */
export const HELP_DESK_COLUMNS = {
  details: 'long_text0r77midd',
  urgency: 'color_mktmm9m',
  tool: 'dropdown_mktm2xjc',
  requestType: 'dropdown_mktmvmyd',
  clientName: 'text_mktm7w8k',
  clientEmail: 'email_mm0y1pzt',
  phone: 'phone_mm0y4xbz',
  location: 'dropdown_mktmfyx',
  attachments: 'file_mktm40az',
} as const;

/** Dev team contact details, shown on the page and used for the email fallback. */
export const DEV_CONTACT = {
  org: 'Oz Marketing',
  email: 'devteam@ozmktg.com',
  phone: '801-927-1774',
  /** `tel:` needs digits only. */
  phoneHref: '+18019271774',
} as const;

/**
 * Request types. These mirror the labels already on the board's "Type of
 * Request" dropdown — the board also carries older one-word variants (Bug,
 * Access, Billing…) that we deliberately don't offer, so in-app reports file
 * consistently.
 */
export const REQUEST_TYPES = [
  'Bug/Technical Issue',
  'Feature Request',
  'Account/Access Issue',
  'Training/How-To Question',
  'Other',
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** Board "Urgency" labels, least to most severe. */
export const URGENCY_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

/** One-line guidance per urgency so people don't file everything as Critical. */
export const URGENCY_HINTS: Record<Urgency, string> = {
  Low: 'A papercut or nice-to-have — no rush.',
  Medium: 'Slows you down, but you can work around it.',
  High: 'Blocks part of your work and there is no workaround.',
  Critical: 'Nobody can work, or something client-facing is broken right now.',
};

/** Which Loomi surface the report came from. */
export type SupportSurface = 'studio' | 'app' | 'reporting';

/**
 * Surface → the board's "Tool" dropdown. Reporting has no label of its own on
 * the board and ships as part of Studio, so it files under Loomi Studio; the
 * exact surface is always recorded in the details block regardless.
 */
export const SURFACE_TOOL_LABEL: Record<SupportSurface, string> = {
  studio: 'Loomi Studio',
  app: 'Loomi Projects',
  reporting: 'Loomi Studio',
};

/** Input limits — enforced on the server, mirrored in the form's maxLength. */
export const LIMITS = {
  subject: 160,
  name: 120,
  email: 200,
  phone: 40,
  details: 15_000,
  pageUrl: 500,
  attachmentCount: 5,
  attachmentBytes: 15 * 1024 * 1024,
} as const;

/** What the client posts and the server maps onto the board. */
export interface SupportRequestInput {
  subject: string;
  details: string;
  requestType: RequestType;
  urgency: Urgency;
  name: string;
  email: string;
  phone?: string;
  /** Loomi account the reporter was working in — matched to "Location". */
  accountName?: string;
  surface: SupportSurface;
  /** Where in the app it happened. Collected automatically, editable. */
  pageUrl?: string;
  /** Browser diagnostics captured client-side; appended to the details block. */
  userAgent?: string;
  viewport?: string;
  /** Loomi role of the reporter — useful triage context, never user-supplied. */
  userRole?: string | null;
  /** ISO timestamp of submission. */
  submittedAt?: string;
}

export function isRequestType(value: unknown): value is RequestType {
  return typeof value === 'string' && (REQUEST_TYPES as readonly string[]).includes(value);
}

export function isUrgency(value: unknown): value is Urgency {
  return typeof value === 'string' && (URGENCY_LEVELS as readonly string[]).includes(value);
}

export function isSupportSurface(value: unknown): value is SupportSurface {
  return value === 'studio' || value === 'app' || value === 'reporting';
}

/**
 * Normalize a name for label matching: lowercase, strip the `|` separators and
 * punctuation monday labels use ("Young CDJR | Layton"), collapse whitespace.
 */
function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[|,./\\-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match a Loomi account name onto one of the board's "Location" labels.
 *
 * The two lists were authored independently, so they rhyme without matching:
 * Loomi has "Young Honda Ogden" where the board has "Young Honda", and the
 * board writes "Young CDJR | Layton" where Loomi writes "Young CDJR Layton".
 * We accept an exact normalized match or a full-token-subset match in either
 * direction, then take the longest (most specific) survivor.
 *
 * Returns `null` when nothing matches confidently — the caller falls back to
 * "Other" rather than minting a new label, so an account rename can't quietly
 * litter the board with near-duplicates. The real account name always goes
 * into the details block, so the mapping is never load-bearing.
 */
export function matchLocationLabel(
  accountName: string | undefined,
  labels: readonly string[],
): string | null {
  if (!accountName?.trim() || labels.length === 0) return null;

  const target = normalizeLabel(accountName);
  if (!target) return null;
  const targetTokens = new Set(target.split(' '));

  let best: { label: string; score: number } | null = null;
  for (const label of labels) {
    const normalized = normalizeLabel(label);
    if (!normalized) continue;

    let score = 0;
    if (normalized === target) {
      score = 1000;
    } else {
      const tokens = normalized.split(' ');
      // A label whose every word appears in the account name (or vice versa).
      const labelInTarget = tokens.every((t) => targetTokens.has(t));
      const targetInLabel = [...targetTokens].every((t) => tokens.includes(t));
      if (!labelInTarget && !targetInLabel) continue;
      // Single-word overlaps ("Young", "Mazda") are too loose to trust.
      if (tokens.length < 2) continue;
      score = tokens.length;
    }
    if (!best || score > best.score) best = { label, score };
  }

  return best?.label ?? null;
}

/**
 * monday sanitizes long-text values as HTML on the way in, so anything that
 * looks like a tag is deleted outright — verified against the live board, where
 * `Name <someone@example.com>` arrived as `Name `. That's a silent data loss
 * exactly where it hurts most: a bug report quoting `<div>` or an error like
 * `Unexpected token <` would lose the very detail it was filed about.
 *
 * Swapping in the single-guillemet lookalikes keeps every character visible and
 * costs nothing but a glyph. Escaping to `&lt;` was the obvious alternative and
 * is worse — monday would render the entity literally in some views and decode
 * it in others, so the reader can't tell what was actually typed.
 */
function neutralizeAngleBrackets(value: string): string {
  return value.replaceAll('<', '‹').replaceAll('>', '›');
}

/** The item title on the board. Prefixed so in-app reports are scannable. */
export function buildItemName(input: SupportRequestInput): string {
  const subject = input.subject.trim() || 'Support request';
  return subject.slice(0, LIMITS.subject);
}

/**
 * The board's "Details" long-text body: what the person wrote, followed by the
 * context we captured for them.
 *
 * The diagnostics block is the whole reason this beats the public monday form —
 * "it's broken" arrives with the exact page, account, role and browser attached,
 * so triage doesn't start with a round-trip asking where it happened.
 */
export function buildDetailsBody(input: SupportRequestInput): string {
  const lines: string[] = [input.details.trim()];

  const context: [string, string | null | undefined][] = [
    // Parentheses, NOT `Name <email>`: monday sanitizes long-text as HTML, so
    // anything in angle brackets is stripped on the way in — verified against
    // the live board, where the address vanished from an otherwise intact body.
    ['Reported by', `${input.name.trim()} (${input.email.trim()})`],
    ['Role', input.userRole ?? null],
    ['Account', input.accountName ?? null],
    ['Surface', SURFACE_TOOL_LABEL[input.surface]],
    ['Page', input.pageUrl ?? null],
    ['Browser', input.userAgent ?? null],
    ['Viewport', input.viewport ?? null],
    ['Submitted', input.submittedAt ?? null],
  ];

  const rendered = context
    .filter(([, value]) => Boolean(value && String(value).trim()))
    .map(([label, value]) => `${label}: ${String(value).trim()}`);

  if (rendered.length > 0) {
    lines.push('', '— Submitted from Loomi —', ...rendered);
  }

  return neutralizeAngleBrackets(lines.join('\n'));
}

/**
 * Build the monday `column_values` payload.
 *
 * `locationLabel` / `toolLabel` are resolved by the caller against the board's
 * live label list (see `matchLocationLabel`) so we only ever send labels that
 * already exist — `create_labels_if_missing` stays off.
 */
export function buildColumnValues(
  input: SupportRequestInput,
  resolved: { locationLabel?: string | null; toolLabel?: string | null } = {},
): Record<string, unknown> {
  const email = input.email.trim();
  const values: Record<string, unknown> = {
    [HELP_DESK_COLUMNS.details]: { text: buildDetailsBody(input) },
    [HELP_DESK_COLUMNS.requestType]: { labels: [input.requestType] },
    [HELP_DESK_COLUMNS.urgency]: { label: input.urgency },
    [HELP_DESK_COLUMNS.clientName]: input.name.trim().slice(0, LIMITS.name),
    [HELP_DESK_COLUMNS.clientEmail]: { email, text: email },
  };

  const phoneDigits = (input.phone ?? '').replace(/\D+/g, '');
  if (phoneDigits) {
    values[HELP_DESK_COLUMNS.phone] = { phone: phoneDigits, countryShortName: 'US' };
  }
  if (resolved.toolLabel) {
    values[HELP_DESK_COLUMNS.tool] = { labels: [resolved.toolLabel] };
  }
  if (resolved.locationLabel) {
    values[HELP_DESK_COLUMNS.location] = { labels: [resolved.locationLabel] };
  }

  return values;
}
