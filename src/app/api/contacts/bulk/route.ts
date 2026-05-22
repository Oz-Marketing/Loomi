import { NextRequest, NextResponse } from 'next/server';
import { requireRole, forbidden } from '@/lib/api-auth';
import {
  bulkAddToList,
  bulkRemoveFromList,
  bulkAddTags,
  bulkRemoveTags,
  bulkSetDnd,
  bulkDelete,
  type BulkResult,
} from '@/lib/services/contact-bulk';

// POST /api/contacts/bulk
//
// Single endpoint for every bulk action on the contacts table. Body:
//   { accountKey, ids: string[], action: '...', payload?: {...} }
//
// All actions are scoped to the supplied accountKey: contacts from
// a different account in `ids` are silently dropped at the service
// layer so a stale selection can't reach across accounts. Multi-
// account selections are handled by the client batching one call
// per account.

const MAX_IDS_PER_CALL = 5000;

type ActionName =
  | 'addToList'
  | 'removeFromList'
  | 'addTags'
  | 'removeTags'
  | 'setDnd'
  | 'delete';

interface BulkRequestBody {
  accountKey?: unknown;
  ids?: unknown;
  action?: unknown;
  payload?: unknown;
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = (await req.json().catch(() => null)) as BulkRequestBody | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return forbidden();
    }
  }

  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: 'ids must be an array of contact IDs' }, { status: 400 });
  }
  const ids = body.ids
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must contain at least one contact ID' }, { status: 400 });
  }
  if (ids.length > MAX_IDS_PER_CALL) {
    return NextResponse.json(
      { error: `Too many ids in one request (max ${MAX_IDS_PER_CALL}). Batch on the client.` },
      { status: 413 },
    );
  }

  const action = typeof body.action === 'string' ? (body.action as ActionName) : null;
  const payload = (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? (body.payload as Record<string, unknown>)
    : {});

  try {
    let result: BulkResult;
    switch (action) {
      case 'addToList': {
        const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
        if (!listId) {
          return NextResponse.json({ error: 'payload.listId is required for addToList' }, { status: 400 });
        }
        result = await bulkAddToList(accountKey, ids, listId);
        break;
      }
      case 'removeFromList': {
        const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
        if (!listId) {
          return NextResponse.json({ error: 'payload.listId is required for removeFromList' }, { status: 400 });
        }
        result = await bulkRemoveFromList(accountKey, ids, listId);
        break;
      }
      case 'addTags': {
        const tags = Array.isArray(payload.tags)
          ? payload.tags.filter((entry): entry is string => typeof entry === 'string')
          : null;
        if (!tags || tags.length === 0) {
          return NextResponse.json(
            { error: 'payload.tags must be a non-empty array of strings' },
            { status: 400 },
          );
        }
        result = await bulkAddTags(accountKey, ids, tags);
        break;
      }
      case 'removeTags': {
        const tags = Array.isArray(payload.tags)
          ? payload.tags.filter((entry): entry is string => typeof entry === 'string')
          : null;
        if (!tags || tags.length === 0) {
          return NextResponse.json(
            { error: 'payload.tags must be a non-empty array of strings' },
            { status: 400 },
          );
        }
        result = await bulkRemoveTags(accountKey, ids, tags);
        break;
      }
      case 'setDnd': {
        const dndRaw = payload.dnd && typeof payload.dnd === 'object' && !Array.isArray(payload.dnd)
          ? (payload.dnd as Record<string, unknown>)
          : null;
        if (!dndRaw) {
          return NextResponse.json(
            { error: 'payload.dnd must be an object with optional email/sms booleans' },
            { status: 400 },
          );
        }
        const patch: { email?: boolean; sms?: boolean } = {};
        if (typeof dndRaw.email === 'boolean') patch.email = dndRaw.email;
        if (typeof dndRaw.sms === 'boolean') patch.sms = dndRaw.sms;
        result = await bulkSetDnd(accountKey, ids, patch);
        break;
      }
      case 'delete': {
        result = await bulkDelete(accountKey, ids);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unknown action "${String(action)}"` },
          { status: 400 },
        );
    }

    return NextResponse.json({ ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
