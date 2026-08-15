'use client';

import { useState } from 'react';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AgencySettingsModal } from '@/components/settings/agency-settings-modal';

/**
 * Top-bar entry to Agency Settings — the platform-management tier.
 *
 * Shared by all three surfaces' utility bars so the door is in the same place
 * everywhere. It opens a modal over the current page rather than navigating:
 * the tier is somewhere you step into and back out of, and nothing about the
 * surrounding page — route, account scope, nav — changes while it's open.
 *
 * Hidden for roles with no platform access — a client has nothing to manage.
 */
export function AgencySettingsButton({ className }: { className?: string }) {
  const { userRole } = useAccount();
  const [open, setOpen] = useState(false);

  const hasAdminAccess =
    userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  if (!hasAdminAccess) return null;

  return (
    <>
      <button
        type="button"
        title="Agency Settings"
        aria-label="Agency Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          className ??
          'inline-flex h-8 w-8 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]'
        }
      >
        <Cog6ToothIcon className="h-5 w-5" />
      </button>
      {open && <AgencySettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
