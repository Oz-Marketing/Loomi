import type { SelectOption } from '@/components/select';

/**
 * The legacy `User.role` choices, as dropdown options.
 *
 * `developer` is only offered to a developer — it bypasses every permission
 * check, so it must not be assignable by the admins who can otherwise edit
 * users. The API enforces the same rule; this just keeps it off the screen.
 *
 * Shared by the new-user and user-detail forms so the two lists can't drift.
 */
export function platformRoleOptions(actorRole: string | null | undefined): SelectOption[] {
  return [
    ...(actorRole === 'developer' ? [{ value: 'developer', label: 'Developer' }] : []),
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin', label: 'Admin' },
    { value: 'client', label: 'Client' },
  ];
}
