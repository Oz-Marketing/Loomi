'use client';

import useSWR from 'swr';
import type { FormSummary } from '@/lib/services/forms';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

/**
 * Dropdown of the user's Forms — used by the EmbeddedForm block's
 * formId prop. Lists every Form the API surfaces (account scope is
 * enforced server-side); shows the form name + slug so users can
 * pick the right one even when names collide.
 */
export function FormPickerInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data, isLoading } = useSWR<{ forms: FormSummary[]; total: number }>(
    '/api/forms?pageSize=100',
    fetcher,
  );
  const forms = data?.forms ?? [];

  if (isLoading) {
    return <div className="text-[11px] text-[var(--muted-foreground)] py-2">Loading forms…</div>;
  }

  if (forms.length === 0) {
    return (
      <div className="text-[11px] text-[var(--muted-foreground)] py-2">
        No forms found. Create one under Websites → Forms first.
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      <option value="">— Pick a form —</option>
      {forms.map((form) => (
        <option key={form.id} value={form.id}>
          {form.name || 'Untitled'} ({form.slug})
        </option>
      ))}
    </select>
  );
}
