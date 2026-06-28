/**
 * Client-safe Projects UI constants — status/priority/kind metadata shared by
 * the board, table, my-work, calendar, and detail views. No server imports.
 */

export type StatusKey = 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'canceled';

export const STATUSES: { key: StatusKey; label: string; dot: string }[] = [
  { key: 'todo', label: 'To do', dot: '#94a3b8' },
  { key: 'in_progress', label: 'In progress', dot: '#3b82f6' },
  { key: 'in_review', label: 'In review', dot: '#a855f7' },
  { key: 'blocked', label: 'Blocked', dot: '#ef4444' },
  { key: 'done', label: 'Done', dot: '#22c55e' },
  { key: 'canceled', label: 'Canceled', dot: '#64748b' },
];

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label]),
);
export const STATUS_DOT: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.dot]),
);

export type PriorityKey = 'low' | 'medium' | 'high' | 'urgent';

export const PRIORITY_META: Record<PriorityKey, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#ef4444' },
  high: { label: 'High', color: '#f59e0b' },
  medium: { label: 'Medium', color: '#3b82f6' },
  low: { label: 'Low', color: '#94a3b8' },
};

/** Task kinds — `launch` flags the ones that can spin up a Loomi tool (Phase 2). */
export const KIND_META: Record<string, { label: string; launch?: boolean }> = {
  generic: { label: 'Task' },
  email: { label: 'Email / Text', launch: true },
  sms: { label: 'SMS', launch: true },
  landing_page: { label: 'Landing page', launch: true },
  form: { label: 'Form', launch: true },
  flow: { label: 'Flow', launch: true },
  ads: { label: 'Ads', launch: true },
  design: { label: 'Design' },
  print: { label: 'Print / Mailer' },
  video: { label: 'Video' },
  media_buy: { label: 'Mass Media' },
  pr: { label: 'PR' },
  dev: { label: 'Dev' },
  social: { label: 'Social' },
};

export function kindLabel(kind: string): string {
  return KIND_META[kind]?.label ?? 'Task';
}

/** Ordered kind list for selectors (generic first, then by team-ish grouping). */
export const KIND_OPTIONS: { key: string; label: string; launch?: boolean }[] = [
  'generic',
  'design',
  'print',
  'dev',
  'email',
  'sms',
  'landing_page',
  'form',
  'flow',
  'ads',
  'video',
  'media_buy',
  'pr',
  'social',
].map((k) => ({ key: k, label: KIND_META[k].label, launch: KIND_META[k].launch }));

/**
 * Which task kinds each default team typically produces. Drives the Type
 * filter on intake — selecting teams narrows the Type options to what those
 * teams deliver. Keyed by the seeded default Team.key values; a custom team
 * not listed here contributes no restriction (see kindOptionsForTeams).
 */
export const TEAM_KINDS: Record<string, string[]> = {
  // Email / Text lives under Development for now (it ping-pongs between dev and
  // digital; easy to flip later since teams are DB-managed).
  development: ['dev', 'email', 'landing_page', 'form', 'flow'],
  'digital-ads': ['ads', 'landing_page', 'form'],
  'organic-social': ['social'],
  'pr-mass-media': ['pr', 'media_buy'],
  'video-production': ['video'],
  'graphic-design': ['design', 'print'],
};

/**
 * Kinds that produce a designed/creative asset. When a ticket spans multiple
 * accounts, these are the kinds where "same creative for all" vs "unique per
 * dealer" is a meaningful choice (a 'shared' creative collapses to one task
 * instead of one per dealer).
 */
export const CREATIVE_KINDS = new Set([
  'design',
  'print',
  'email',
  'sms',
  'ads',
  'social',
  'video',
]);

export function isCreativeKind(kind: string): boolean {
  return CREATIVE_KINDS.has(kind);
}

/**
 * Type options available for a set of selected teams. Always keeps 'generic'
 * (Task) as a fallback. No teams selected — or any unknown/custom team in the
 * set — returns the full list rather than over-restricting.
 */
export function kindOptionsForTeams(teamKeys: string[]): typeof KIND_OPTIONS {
  if (teamKeys.length === 0) return KIND_OPTIONS;
  const allowed = new Set<string>(['generic']);
  for (const tk of teamKeys) {
    const kinds = TEAM_KINDS[tk];
    if (!kinds) return KIND_OPTIONS; // unknown team — don't restrict
    kinds.forEach((k) => allowed.add(k));
  }
  return KIND_OPTIONS.filter((o) => allowed.has(o.key));
}

// ── Per-type field config ─────────────────────────────────────────────
// Reps only see the fields for the Types they pick. Distilled from the legacy
// 95-question Monday intake. Values are stored in Task.details (JSON), keyed by
// FieldDef.key. Options are first-pass — tune freely; no schema impact.

export type FieldInput =
  | 'text'
  | 'longtext'
  | 'number'
  | 'date'
  | 'multiselect'
  | 'toggle';

export interface FieldDef {
  key: string;
  label: string;
  input: FieldInput;
  options?: string[];
  required?: boolean;
  hint?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Fields shown for each task Type. Empty = no extra fields (Brief covers it). */
export const TYPE_FIELDS: Record<string, FieldDef[]> = {
  design: [
    { key: 'designTypes', label: 'Design types', input: 'multiselect',
      options: ['Logo', 'Web banner', 'Social graphic', 'Flyer', 'Email graphic', 'Billboard', 'Other'] },
    { key: 'proofDate', label: 'Creative proof date', input: 'date' },
    { key: 'hitDate', label: 'Hit date', input: 'date' },
  ],
  print: [
    { key: 'printTypes', label: 'Print types', input: 'multiselect',
      options: ['Mailer (EDDM)', 'Mailer (data list)', 'Brochure', 'Flyer', 'Postcard', 'Other'] },
    { key: 'mailerBudget', label: 'Mailer budget', input: 'number' },
    { key: 'dataPullType', label: 'Data pull type', input: 'multiselect',
      options: ['EDDM', 'Purchased list', 'Client list', 'Conquest'] },
    { key: 'eddZip', label: 'EDDM zip code(s)', input: 'text' },
    { key: 'dataParams', label: 'Data parameters', input: 'longtext' },
    { key: 'printInstructions', label: 'Print details & instructions', input: 'longtext' },
  ],
  email: [
    { key: 'deliveryMethods', label: 'Delivery methods', input: 'multiselect',
      options: ['Email', 'Text / SMS'], required: true },
    { key: 'budget', label: 'Budget', input: 'number' },
    { key: 'audienceTargeting', label: 'Audience targeting', input: 'multiselect',
      options: ['Customer list', 'Lookalike', 'Geo radius', 'Past leads', 'Service customers', 'Conquest'] },
    { key: 'audienceDetails', label: 'Audience details', input: 'longtext' },
    { key: 'sendDate', label: 'Send date', input: 'date' },
  ],
  ads: [
    { key: 'channels', label: 'Channels', input: 'multiselect',
      options: ['Facebook', 'Google', 'TikTok', 'SEM', 'KSL'] },
    { key: 'requestType', label: 'Request type', input: 'multiselect',
      options: ['New campaign', 'Add budget', 'Creative refresh', 'Audience change'] },
    { key: 'budget', label: 'Total budget', input: 'number',
      hint: 'Per-channel split can go in the brief.' },
  ],
  dev: [
    { key: 'devType', label: 'Dev type', input: 'multiselect',
      options: ['New page', 'Edit existing', 'Landing page', 'Form', 'Integration', 'Bug fix', 'Other'] },
  ],
  pr: [
    { key: 'prType', label: 'PR type', input: 'multiselect',
      options: ['Press release', 'Sponsorship', 'Community event', 'Media outreach'] },
    { key: 'pressReleaseDate', label: 'Press release date', input: 'date' },
    { key: 'sponsorshipAmount', label: 'Sponsorship amount', input: 'number' },
    { key: 'sponsorshipInfo', label: 'Sponsorship name & info', input: 'longtext' },
  ],
  media_buy: [
    { key: 'mediaTypes', label: 'Mass-media types', input: 'multiselect',
      options: ['Radio', 'Billboard', 'TV', 'OTT'] },
    { key: 'radioBudget', label: 'Radio budget', input: 'number' },
    { key: 'billboardBudget', label: 'Billboard budget', input: 'number' },
    { key: 'tvBudget', label: 'TV budget', input: 'number' },
  ],
  video: [
    { key: 'format', label: 'Format', input: 'multiselect',
      options: ['Commercial', 'Social video', 'Radio spot', 'OTT / CTV', 'YouTube', 'Photography'] },
    { key: 'videoBudget', label: 'Production budget', input: 'number' },
    { key: 'voiceover', label: 'Voiceover needed?', input: 'toggle' },
    { key: 'referenceLinks', label: 'Reference links', input: 'text' },
    { key: 'endSlate', label: 'End-slate info', input: 'longtext' },
  ],
};

export function fieldsForKind(kind: string): FieldDef[] {
  return TYPE_FIELDS[kind] ?? [];
}

/** Minimal billing block — collapsed on the form; deeper accounting is internal. */
export const BILLING_FIELDS: FieldDef[] = [
  { key: 'costs', label: 'Costs', input: 'number' },
  { key: 'billingMonths', label: 'Billing month(s)', input: 'multiselect', options: MONTHS },
  { key: 'retainer', label: 'Client under retainer?', input: 'toggle' },
];

/** "Jun 24", "Jun 24 2027" if not the current year. Date-only ISO-safe. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  // Parse 'YYYY-MM-DD' as a LOCAL date; `new Date('YYYY-MM-DD')` would treat it
  // as UTC midnight and render a day early in negative-offset timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

/** Due-date urgency for badge coloring. */
export function dueState(iso: string | null, done: boolean): 'none' | 'soon' | 'overdue' | 'ok' {
  if (!iso || done) return 'none';
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'soon';
  return 'ok';
}
