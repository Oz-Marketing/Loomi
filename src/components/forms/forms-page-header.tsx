'use client';

import * as React from 'react';
import { PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { usePathname } from 'next/navigation';
import { isSubaccountRoute, extractSlugFromPath } from '@/lib/account-slugs';
import { NewFormModal } from '@/components/forms/new-form-modal';

export function FormsPageHeader({
  accountKey,
  disabledReason,
}: {
  accountKey: string | null;
  disabledReason?: string;
}) {
  const disabled = !accountKey;
  const pathname = usePathname();

  // Detect sub-account context so the create POST can include the slug;
  // the server uses it to redirect into the matching /subaccount/<slug>
  // URL space after creating the form.
  const urlSlug = isSubaccountRoute(pathname) ? extractSlugFromPath(pathname) : null;
  const subaccountSlug = urlSlug || '';

  const [modalOpen, setModalOpen] = React.useState(false);

  return (
    <>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <DocumentTextIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Forms</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Build embeddable lead-capture forms for the selected account.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={disabled}
            title={disabled ? disabledReason : 'Create a new form'}
            className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-4 h-4" />
            New Form
          </button>
        </div>
      </div>

      <NewFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accountKey={accountKey}
        subaccountSlug={subaccountSlug}
      />
    </>
  );
}
