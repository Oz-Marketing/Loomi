'use client';

import { ArchiveBoxIcon } from '@heroicons/react/24/outline';

// Reusable "Show archived" pill toggle for table toolbars. Used by
// any list that supports an archived state (Flows, Emails, ...).
// Renders a small chip styled to match other toolbar controls.
// Includes a subtitle tooltip noting the 30-day retention window so
// users understand that archived ≠ permanent storage.
export function IncludeArchivedToggle({
  value,
  onChange,
  className,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      title={
        value
          ? 'Hide archived (only show live items). Archived items auto-delete after 30 days.'
          : 'Show archived. Archived items auto-delete after 30 days.'
      }
      className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
        value
          ? 'border-[var(--primary)]/60 bg-[var(--primary)]/15 text-[var(--foreground)]'
          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]'
      } ${className || ''}`}
    >
      <ArchiveBoxIcon className="w-3.5 h-3.5" />
      {value ? 'Hiding none' : 'Show archived'}
    </button>
  );
}
