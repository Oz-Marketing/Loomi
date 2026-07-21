'use client';

import { DocumentTextIcon } from '@heroicons/react/24/outline';
import type { FormSummary } from '@/lib/services/forms';
import { FormCard } from '@/components/forms/form-card';

interface FormsListProps {
  forms: FormSummary[];
  loading?: boolean;
  accountNames?: Record<string, string>;
  onDelete?: (form: FormSummary) => void;
  /** Save a live form's design as a reusable template (live-form view only). */
  onSaveAsTemplate?: (form: FormSummary) => void;
  /** Deploy a template into sub-account(s) as live forms (template view only). */
  onDeploy?: (form: FormSummary) => void;
  /** 'template' renders template cards (click → editor, no live-form meta). */
  variant?: 'form' | 'template';
  /** Override the empty-state copy (e.g. for the Templates gallery). */
  emptyState?: { title: string; subtitle: string };
}

export function FormsList({
  forms,
  loading,
  accountNames,
  onDelete,
  onSaveAsTemplate,
  onDeploy,
  variant = 'form',
  emptyState,
}: FormsListProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="glass-card rounded-xl h-72 animate-pulse bg-[var(--muted)]/30"
          />
        ))}
      </div>
    );
  }

  if (forms.length === 0) {
    return (
      <div className="glass-card rounded-2xl px-6 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <DocumentTextIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">
          {emptyState?.title ?? 'No forms yet'}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {emptyState?.subtitle ??
            'Create your first form and start shaping the capture experience.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {forms.map((form) => (
        <FormCard
          key={form.id}
          form={form}
          variant={variant}
          accountName={accountNames?.[form.accountKey]}
          onDelete={onDelete}
          onSaveAsTemplate={onSaveAsTemplate}
          onDeploy={onDeploy}
        />
      ))}
    </div>
  );
}
