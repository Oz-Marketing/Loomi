'use client';

import Link from 'next/link';
import { ArrowLeftIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { FormSettingsForm } from '@/components/forms/form-settings-form';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

export default function FormSettingsPage() {
  const { form } = useFormDetail();
  const subHref = useSubaccountHref();

  return (
    <AdminOnly>
      <div className="space-y-5">
        <div className="page-sticky-header">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href={subHref(`/websites/forms/${form.id}`)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors flex-shrink-0"
                aria-label="Back to overview"
              >
                <ArrowLeftIcon className="w-4 h-4" />
              </Link>
              <Cog6ToothIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold truncate">Settings</h2>
                <p className="text-[var(--muted-foreground)] mt-1 text-sm truncate">
                  {form.name || 'Untitled form'}
                </p>
              </div>
            </div>
          </div>
        </div>
        <FormSettingsForm />
      </div>
    </AdminOnly>
  );
}
