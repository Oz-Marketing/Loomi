'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowTopRightOnSquareIcon,
  ClockIcon,
  GlobeAltIcon,
  IdentificationIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { FormSubmissionRow } from '@/lib/services/forms';
import type { Block, FormTemplate } from '@/lib/forms/types';
import { collectFieldBlocks, getFieldName } from '@/lib/forms/types';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface SubmissionDetailDrawerProps {
  submission: FormSubmissionRow | null;
  /** The form's schema — used to resolve field names back to their
   *  user-facing labels. When absent the drawer falls back to raw
   *  field keys (still works, just less friendly). */
  schema?: FormTemplate;
  /** Owning account of the form. Required to build a working
   *  "View contact" link — the contact detail page resolves the
   *  contact by id + accountKey, and errors without the latter. */
  accountKey?: string;
  onClose: () => void;
}

/**
 * Side-drawer detail view for a single FormSubmission. Mirrors the
 * sent-campaign drawer pattern: backdrop + sliding panel from the
 * right, header with timestamp, sectioned body, link to the related
 * contact in the CRM.
 */
export function SubmissionDetailDrawer({
  submission,
  schema,
  accountKey,
  onClose,
}: SubmissionDetailDrawerProps) {
  const open = !!submission;
  const subHref = useSubaccountHref();

  // Esc to close + lock body scroll while the drawer is up so the
  // overview behind doesn't scroll under us.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!submission) return null;

  // Build a name → label lookup from the schema so the data rows
  // show "Email" instead of "email" or a raw block id.
  const fieldBlocks = schema ? collectFieldBlocks(schema) : [];
  const labelByName = new Map<string, string>();
  for (const block of fieldBlocks) {
    if (block.type === 'submit_button') continue;
    const name = getFieldName(block);
    const label = pickLabel(block);
    labelByName.set(name, label);
  }

  // Order: render fields in schema order first (so the drawer reads
  // top-down like the form), then any extras left in `data` that
  // aren't in the schema (renamed/removed fields from older
  // submissions) so nothing gets silently dropped.
  const dataEntries: { name: string; label: string; value: unknown }[] = [];
  const seen = new Set<string>();
  for (const block of fieldBlocks) {
    if (block.type === 'submit_button') continue;
    const name = getFieldName(block);
    if (name in submission.data) {
      dataEntries.push({
        name,
        label: labelByName.get(name) ?? name,
        value: submission.data[name],
      });
      seen.add(name);
    }
  }
  for (const [name, value] of Object.entries(submission.data)) {
    if (seen.has(name)) continue;
    if (name.startsWith('_loomi_')) continue; // honeypot etc.
    dataEntries.push({ name, label: name, value });
  }

  const contact = submission.contact;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="absolute top-3 right-3 bottom-3 w-[min(480px,calc(100vw-1.5rem))] bg-[var(--card-strong)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Submission</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5 inline-flex items-center gap-1.5">
              <ClockIcon className="w-3.5 h-3.5" />
              {new Date(submission.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Contact card */}
          <section className="px-5 py-4 border-b border-[var(--border)]">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2">
              Contact
            </h4>
            {contact ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                  <IdentificationIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {contact.fullName || contact.email || contact.phone || 'Contact'}
                  </p>
                  <div className="mt-0.5 space-y-0.5 text-xs text-[var(--muted-foreground)]">
                    {contact.email && <p className="truncate">{contact.email}</p>}
                    {contact.phone && <p className="truncate">{contact.phone}</p>}
                  </div>
                  <Link
                    href={subHref(
                      accountKey
                        ? `/contacts/${contact.id}?accountKey=${encodeURIComponent(accountKey)}`
                        : `/contacts/${contact.id}`,
                    )}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                  >
                    View contact
                    <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                Anonymous submission — no email or phone supplied, so no
                Contact was created.
              </p>
            )}
          </section>

          {/* Submitted field values */}
          <section className="px-5 py-4 border-b border-[var(--border)]">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-3">
              Submitted values
            </h4>
            {dataEntries.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No field values captured.
              </p>
            ) : (
              <dl className="space-y-3">
                {dataEntries.map((entry) => (
                  <div key={entry.name}>
                    <dt className="text-[11px] font-medium text-[var(--muted-foreground)]">
                      {entry.label}
                    </dt>
                    <dd className="mt-1 text-sm text-[var(--foreground)] break-words">
                      {renderValue(entry.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {/* Metadata */}
          <section className="px-5 py-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-3">
              Metadata
            </h4>
            <dl className="space-y-2 text-xs">
              <MetaRow
                icon={<IdentificationIcon className="w-3.5 h-3.5" />}
                label="Submission ID"
                value={<span className="font-mono">{submission.id}</span>}
              />
              {submission.ipAddress && (
                <MetaRow
                  icon={<GlobeAltIcon className="w-3.5 h-3.5" />}
                  label="IP address"
                  value={submission.ipAddress}
                />
              )}
              {submission.referrer && (
                <MetaRow
                  icon={<ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />}
                  label="Referrer"
                  value={
                    <a
                      href={submission.referrer}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] hover:underline break-all"
                    >
                      {submission.referrer}
                    </a>
                  }
                />
              )}
              {submission.userAgent && (
                <MetaRow
                  icon={<GlobeAltIcon className="w-3.5 h-3.5" />}
                  label="User agent"
                  value={<span className="break-all">{submission.userAgent}</span>}
                />
              )}
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function pickLabel(block: Block): string {
  const props = block.props as Record<string, unknown>;
  if (typeof props.label === 'string' && props.label.trim()) {
    return props.label.trim();
  }
  // Hidden + consent fields often have no visible label; fall back
  // to the canonical name so the drawer still shows them with
  // something readable.
  if (typeof props.name === 'string' && props.name.trim()) {
    return props.name.trim();
  }
  return block.id;
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--muted-foreground)]/70 italic">empty</span>;
  }
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[var(--muted-foreground)]/70 italic">empty</span>;
    }
    return value.map((v) => String(v)).join(', ');
  }
  return String(value);
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
      <dt className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
        {icon}
        {label}
      </dt>
      <dd className="text-[var(--foreground)] min-w-0">{value}</dd>
    </div>
  );
}
