'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { FormsList } from '@/components/forms/forms-list';
import type { FormSummary } from '@/lib/services/forms';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Forms tab of the unified /templates page. Lists reusable form
 * templates (Form rows with isTemplate=true) as cards; clicking a card
 * opens the form editor. New templates are created from a live form via
 * its "Save as template" action on /websites/forms.
 */
export function FormTemplatesTab({ accountKey }: { accountKey?: string }) {
  const { accounts } = useAccount();
  const { confirm } = useLoomiDialog();

  const query = accountKey
    ? `?isTemplate=true&accountKey=${encodeURIComponent(accountKey)}`
    : '?isTemplate=true';
  const { data, isLoading, error, mutate } = useSWR<{ forms: FormSummary[] }>(
    `/api/forms${query}`,
    fetcher,
  );

  const accountNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, account] of Object.entries(accounts)) map[key] = account.dealer;
    return map;
  }, [accounts]);

  const templates = data?.forms ?? [];

  const handleDelete = async (form: FormSummary) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${form.name || 'Untitled template'}" will be permanently removed.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/forms/${form.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Delete failed.');
      return;
    }
    toast.success('Template deleted.');
    await mutate();
  };

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
        Form templates could not be loaded.
      </div>
    );
  }

  return (
    <FormsList
      forms={templates}
      loading={isLoading}
      variant="template"
      accountNames={!accountKey ? accountNames : undefined}
      onDelete={(form) => void handleDelete(form)}
      emptyState={{
        title: 'No form templates yet',
        subtitle:
          'Open a form on the Forms page and choose “Save as template” to reuse its design here.',
      }}
    />
  );
}
