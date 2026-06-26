/**
 * Client-safe Projects UI constants — status/priority/kind metadata shared by
 * the board, table, my-work, calendar, and detail views. No server imports.
 */

export type StatusKey = 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done';

export const STATUSES: { key: StatusKey; label: string; dot: string }[] = [
  { key: 'todo', label: 'To do', dot: '#94a3b8' },
  { key: 'in_progress', label: 'In progress', dot: '#3b82f6' },
  { key: 'in_review', label: 'In review', dot: '#a855f7' },
  { key: 'blocked', label: 'Blocked', dot: '#ef4444' },
  { key: 'done', label: 'Done', dot: '#22c55e' },
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
  email: { label: 'Email', launch: true },
  sms: { label: 'SMS', launch: true },
  landing_page: { label: 'Landing page', launch: true },
  form: { label: 'Form', launch: true },
  flow: { label: 'Flow', launch: true },
  ads: { label: 'Ads', launch: true },
  design: { label: 'Design' },
  video: { label: 'Video' },
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
  'dev',
  'email',
  'sms',
  'landing_page',
  'form',
  'flow',
  'ads',
  'video',
  'pr',
  'social',
].map((k) => ({ key: k, label: KIND_META[k].label, launch: KIND_META[k].launch }));

/** "Jun 24", "Jun 24 2027" if not the current year. Date-only ISO-safe. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
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
