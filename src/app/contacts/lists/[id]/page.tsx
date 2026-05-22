'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  ListBulletIcon,
  MinusCircleIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { ContactsTable, type BulkActionContext } from '@/components/contacts/contacts-table';
import type { BulkActionDockItem } from '@/components/bulk-action-dock';
import { toast } from '@/lib/toast';
import type { Contact } from '@/lib/contacts/types';

// Member view for a single contact list. The members table reuses
// ContactsTable so list members look identical to All Contacts; the
// header offers a CSV upload that routes back through the standard
// /contacts/import flow with ?listId= so new uploads land directly
// on this list.

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  accountKey: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

interface ListDetailResponse {
  list: ListDetail;
  members: Contact[];
}

export default function ListDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? '');
  const subHref = useSubaccountHref();
  const { accounts, isAccount } = useAccount();

  const [list, setList] = useState<ListDetail | null>(null);
  const [members, setMembers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/lists/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
      }
      const payload = data as ListDetailResponse;
      setList(payload.list);
      setMembers(Array.isArray(payload.members) ? payload.members : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load list');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Surface a "Remove from list" action on the dock. The list is
  // account-scoped so every selected contact should be in
  // list.accountKey; the bulk API rejects any stragglers. Defined
  // here (before any early returns) so the hook order stays stable
  // between the loading state and the loaded state.
  const listId = list?.id ?? '';
  const listAccountKey = list?.accountKey ?? '';
  const buildExtraActions = useCallback(
    (ctx: BulkActionContext): BulkActionDockItem[] => [
      {
        id: 'remove-from-list',
        label: 'Remove from list',
        icon: <MinusCircleIcon className="w-4 h-4" />,
        onClick: async () => {
          if (!listId || !listAccountKey) return;
          const ids = ctx.selectionByAccount[listAccountKey] ?? [];
          if (ids.length === 0) return;
          if (
            !confirm(
              `Remove ${ids.length.toLocaleString()} ${ids.length === 1 ? 'contact' : 'contacts'} from this list? The contacts themselves stay in your database.`,
            )
          ) {
            return;
          }
          try {
            const res = await fetch('/api/contacts/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountKey: listAccountKey,
                ids,
                action: 'removeFromList',
                payload: { listId },
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(typeof data.error === 'string' ? data.error : 'Failed to remove');
            }
            const removed = typeof data.affected === 'number' ? data.affected : 0;
            toast.success(`Removed ${removed.toLocaleString()} from the list.`);
            ctx.clearSelection();
            fetchList();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove from list');
          }
        },
      },
    ],
    [listAccountKey, listId, fetchList],
  );

  async function handleDelete() {
    if (!list) return;
    if (!confirm(`Delete list "${list.name}"? Contacts will remain — only the list itself is removed.`)) return;
    try {
      const res = await fetch(`/api/contacts/lists/${encodeURIComponent(list.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to delete list');
      }
      toast.success(`List "${list.name}" deleted.`);
      router.push(subHref('/contacts/lists'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete list');
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
        Loading list…
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-medium">{error ?? 'List not found'}</p>
        <Link
          href={subHref('/contacts/lists')}
          className="text-xs text-[var(--primary)] hover:underline mt-2 inline-block"
        >
          ← Back to Lists
        </Link>
      </div>
    );
  }

  const dealer = accounts[list.accountKey]?.dealer || list.accountKey;
  const importHref = subHref(`/contacts/import?listId=${encodeURIComponent(list.id)}`);

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={subHref('/contacts/lists')}
              className="p-2 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 transition-colors"
              title="Back to Lists"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
            <ListBulletIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold truncate">{list.name}</h2>
              <p className="text-[var(--muted-foreground)] mt-1 text-sm inline-flex items-center gap-1.5">
                <UsersIcon className="w-3.5 h-3.5" />
                {list.memberCount.toLocaleString()} {list.memberCount === 1 ? 'contact' : 'contacts'}
                {!isAccount && <span className="text-[var(--muted-foreground)]/70"> · {dealer}</span>}
              </p>
              {list.description && (
                <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-2xl">
                  {list.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href={importHref}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40"
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              Upload CSV
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-red-400 hover:bg-red-500/10 hover:border-red-500/40"
              title="Delete list"
            >
              <TrashIcon className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <ListBulletIcon className="w-10 h-10 mx-auto text-[var(--muted-foreground)] mb-3 opacity-60" />
          <p className="text-[var(--foreground)] text-sm font-medium">No contacts yet</p>
          <p className="text-[var(--muted-foreground)] text-xs mt-1 max-w-md mx-auto">
            Upload a CSV to populate this list.
          </p>
          <Link
            href={importHref}
            className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 mt-4"
          >
            <ArrowUpTrayIcon className="w-4 h-4" />
            Upload CSV
          </Link>
        </div>
      ) : (
        <ContactsTable
          contacts={members}
          loading={false}
          error={null}
          accountKey={list.accountKey}
          extraBulkActions={buildExtraActions}
          onMutated={fetchList}
        />
      )}
    </div>
  );
}
