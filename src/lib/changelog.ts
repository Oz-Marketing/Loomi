import {
  SparklesIcon,
  WrenchScrewdriverIcon,
  BugAntIcon,
} from '@heroicons/react/24/outline';

// ── Types ──

export interface ChangelogEntry {
  id: string;
  title: string;
  content: string;
  type: string; // feature | improvement | fix
  status: string; // draft | published
  audience: string; // everyone | staff
  sourceKey: string | null; // e.g. "pr:412" for automated entries
  publishedAt: string;
  createdBy: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EntryType = 'feature' | 'improvement' | 'fix';

export const ENTRY_TYPES: EntryType[] = ['feature', 'improvement', 'fix'];

export type ChangelogStatus = 'draft' | 'published';

/** Who an entry is written for. `staff` keeps it away from client-role users. */
export type ChangelogAudience = 'everyone' | 'staff';

export const AUDIENCES: ChangelogAudience[] = ['everyone', 'staff'];

export const AUDIENCE_META: Record<
  ChangelogAudience,
  { label: string; description: string }
> = {
  everyone: {
    label: 'Everyone',
    description: 'Visible to all users, including clients. Write it for a dealer, not a developer.',
  },
  staff: {
    label: 'Staff only',
    description: 'Visible to admins and developers only. Clients never see it or get notified.',
  },
};

export const TYPE_META: Record<
  EntryType,
  { label: string; color: string; bg: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  feature: { label: 'Feature', color: '#10b981', bg: '#10b98120', Icon: SparklesIcon },
  improvement: { label: 'Improvement', color: '#3b82f6', bg: '#3b82f620', Icon: WrenchScrewdriverIcon },
  fix: { label: 'Fix', color: '#f59e0b', bg: '#f59e0b20', Icon: BugAntIcon },
};

// ── Helpers ──

/** localStorage key holding the publishedAt of the newest entry the user has seen. */
export const CHANGELOG_SEEN_KEY = 'loomi-changelog-seen';

/**
 * The newest PUBLISHED entry's timestamp, or null if there isn't one.
 *
 * Drafts must not count. `/api/changelog` returns them to staff, they sort to
 * the top (their publishedAt defaults to creation time), and treating one as
 * "the latest update" would light the unread dot for something nobody has
 * announced — and leave it lit, since opening the panel can only mark published
 * entries as seen.
 */
export function newestPublishedAt(
  entries: Array<{ status?: string; publishedAt: string }>,
): string | null {
  return entries.find((e) => e.status !== 'draft')?.publishedAt ?? null;
}

/** Should the changelog bell show its unread dot? */
export function hasUnseenChangelog(
  entries: Array<{ status?: string; publishedAt: string }>,
): boolean {
  const latest = newestPublishedAt(entries);
  if (!latest) return false;
  const seen = localStorage.getItem(CHANGELOG_SEEN_KEY);
  return !seen || new Date(latest) > new Date(seen);
}

export function formatChangelogDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}
