'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

const TABS = [
  { key: 'builder', label: 'Builder', href: '' },
  { key: 'settings', label: 'Settings', href: '/settings' },
  { key: 'submissions', label: 'Submissions', href: '/submissions' },
] as const;

/**
 * Secondary nav strip under the top toolbar. Borrows the email
 * editor's in-sidebar tab treatment (border-b indicator, no icons)
 * so the page chrome doesn't compete visually with the toolbar above.
 */
export function FormDetailTabs({ formId }: { formId: string }) {
  const pathname = usePathname();
  const subHref = useSubaccountHref();
  const base = subHref(`/websites/forms/${formId}`);

  return (
    <div className="flex items-center gap-4 border-b border-[var(--border)] flex-shrink-0">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href ? pathname === href : pathname === base;
        return (
          <Link
            key={tab.key}
            href={href}
            className={`relative -mb-px border-b-2 px-1 py-2.5 text-xs font-medium uppercase tracking-[0.08em] transition-colors ${
              active
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
