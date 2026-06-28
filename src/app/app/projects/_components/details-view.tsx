'use client';

import { PaperClipIcon } from '@heroicons/react/24/outline';
import {
  BILLING_FIELDS,
  fieldsForKind,
  formatShortDate,
  kindLabel,
  type FieldDef,
} from '@/lib/projects/ui';

type Values = Record<string, unknown> | null | undefined;
type Attachment = { id?: string; name?: string; url?: string };

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === '' ||
    v === false ||
    (Array.isArray(v) && v.length === 0)
  );
}

const MONEY_RE = /budget|cost|amount/i;

function formatValue(field: FieldDef, v: unknown): string {
  if (field.input === 'toggle') return v ? 'Yes' : 'No';
  if (field.input === 'multiselect') return Array.isArray(v) ? v.join(', ') : String(v);
  if (field.input === 'date') return typeof v === 'string' ? formatShortDate(v) || v : String(v);
  if (field.input === 'number') {
    const n = Number(v);
    if (MONEY_RE.test(field.key) && Number.isFinite(n)) {
      return `$${n.toLocaleString('en-US')}`;
    }
    return String(v);
  }
  return String(v);
}

/** Label/value grid for a FieldDef[] + values (skips empty fields). */
function FieldGrid({ fields, values }: { fields: FieldDef[]; values: Values }) {
  const rows = fields.filter((f) => !isEmpty(values?.[f.key]));
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {rows.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
            {f.label}
          </dt>
          <dd className="text-sm text-[var(--foreground)] break-words">
            {formatValue(f, values?.[f.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function dateRange(start: unknown, end: unknown): string | null {
  const s = typeof start === 'string' && start ? start : null;
  const e = typeof end === 'string' && end ? end : null;
  if (!s && !e) return null;
  if (s && e && s !== e) return `${formatShortDate(s)} – ${formatShortDate(e)}`;
  return formatShortDate((s || e)!);
}

function AttachmentList({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        Attachments
      </p>
      <ul className="flex flex-wrap gap-2">
        {items.map((f, i) => (
          <li key={f.id ?? i}>
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--muted)] px-2 py-1 text-xs text-[var(--foreground)] hover:underline"
            >
              <PaperClipIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="max-w-[12rem] truncate">{f.name ?? 'Attachment'}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ticket-level meta: timing + attachments + billing. Used for the values
 *  stored on the initiative (or a standalone task's `_ticket`). */
function TicketMeta({ meta }: { meta: Values }) {
  if (!meta) return null;
  const events = dateRange(meta.eventDate, meta.eventEnd);
  const run = dateRange(meta.runStart, meta.runEnd);
  const recurring = meta.recurring === true;
  const attachments = Array.isArray(meta.attachments) ? (meta.attachments as Attachment[]) : [];
  const billing = (meta.billing as Values) ?? null;

  const hasTiming = events || run || recurring;
  if (!hasTiming && !attachments.length && !billing) return null;

  return (
    <div className="space-y-4">
      {hasTiming && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {events && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Event date(s)</dt>
              <dd className="text-sm text-[var(--foreground)]">{events}</dd>
            </div>
          )}
          {run && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Run dates</dt>
              <dd className="text-sm text-[var(--foreground)]">{run}</dd>
            </div>
          )}
          {recurring && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Recurring</dt>
              <dd className="text-sm text-[var(--foreground)]">Yes</dd>
            </div>
          )}
        </dl>
      )}
      {attachments.length > 0 && <AttachmentList items={attachments} />}
      {billing && <FieldGrid fields={BILLING_FIELDS} values={billing} />}
    </div>
  );
}

/** Card wrapper. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      {children}
    </div>
  );
}

/** Per-type request details for a task (its kind's fields), plus any ticket-level
 *  meta stashed on a standalone task. Renders nothing when there's nothing. */
export function TaskExtraDetails({ kind, details }: { kind: string; details: Values }) {
  if (!details) return null;
  const fields = fieldsForKind(kind);
  const hasTypeFields = fields.some((f) => !isEmpty(details[f.key]));
  const ticket = (details._ticket as Values) ?? null;
  if (!hasTypeFields && !ticket) return null;

  return (
    <div className="space-y-4">
      {hasTypeFields && (
        <Section title={`${kindLabel(kind)} details`}>
          <FieldGrid fields={fields} values={details} />
        </Section>
      )}
      {ticket && (
        <Section title="Request details">
          <TicketMeta meta={ticket} />
        </Section>
      )}
    </div>
  );
}

/** Ticket-level details for an initiative (timing, attachments, billing). */
export function InitiativeExtraDetails({ details }: { details: Values }) {
  if (!details) return null;
  const events = dateRange(details.eventDate, details.eventEnd);
  const run = dateRange(details.runStart, details.runEnd);
  const recurring = details.recurring === true;
  const attachments = Array.isArray(details.attachments) ? details.attachments : [];
  const billing = (details.billing as Values) ?? null;
  if (!events && !run && !recurring && !attachments.length && !billing) return null;

  return (
    <Section title="Request details">
      <TicketMeta meta={details} />
    </Section>
  );
}
