'use client';

import * as React from 'react';
import useSWR from 'swr';
import { ChevronRightIcon, InboxStackIcon } from '@heroicons/react/24/outline';
import type { FormSubmissionRow } from '@/lib/services/forms';
import type { FormTemplate } from '@/lib/forms/types';
import { SubmissionDetailDrawer } from '@/components/forms/submission-detail-drawer';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

interface SubmissionsTableProps {
  formId: string;
  /** Optional — passed through to the detail drawer so submitted
   *  values can be labelled instead of showing raw field keys. */
  schema?: FormTemplate;
  /** Owning account of the form — threaded to the drawer so its
   *  "View contact" link can resolve the contact detail page. */
  accountKey?: string;
}

export function SubmissionsTable({ formId, schema, accountKey }: SubmissionsTableProps) {
  const { data, isLoading } = useSWR<{
    submissions: FormSubmissionRow[];
    total: number;
  }>(`/api/forms/${formId}/submissions`, fetcher);

  const submissions = data?.submissions ?? [];
  // Row clicked → open the drawer. Stored as the full row so the
  // drawer doesn't have to re-fetch.
  const [selected, setSelected] = React.useState<FormSubmissionRow | null>(null);

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-[var(--muted-foreground)]">
        Loading submissions...
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="glass-card rounded-2xl px-6 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <InboxStackIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">No submissions yet</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Publish the form and share its link or embed snippet — captured
          entries appear here in real time.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="font-semibold">Submissions</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {data?.total ?? 0} total · click a row to inspect
            </p>
          </div>
          <a
            href={`/api/forms/${formId}/submissions?format=csv`}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:border-[var(--primary)]"
          >
            Export CSV
          </a>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {submissions.map((submission) => {
            const label =
              submission.contact?.fullName ||
              submission.contact?.email ||
              submission.contact?.phone ||
              'Anonymous';
            return (
              <button
                type="button"
                key={submission.id}
                onClick={() => setSelected(submission)}
                className="group w-full grid grid-cols-[160px_minmax(0,1fr)_180px_auto] gap-3 px-4 py-3 text-sm text-left hover:bg-[var(--muted)]/40 transition-colors"
              >
                <span className="text-[var(--muted-foreground)]">
                  {new Date(submission.createdAt).toLocaleString()}
                </span>
                <span className="truncate">{label}</span>
                <span className="truncate font-mono text-xs text-[var(--muted-foreground)]">
                  {submission.id}
                </span>
                <ChevronRightIcon className="w-4 h-4 text-[var(--muted-foreground)]/60 group-hover:text-[var(--foreground)]" />
              </button>
            );
          })}
        </div>
      </div>

      <SubmissionDetailDrawer
        submission={selected}
        schema={schema}
        accountKey={accountKey}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
