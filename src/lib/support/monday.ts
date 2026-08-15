/**
 * monday.com client for the in-app help desk.
 *
 * Server-only — it holds the API token. Scope is deliberately tiny: read a
 * board's dropdown labels, create one item, attach files to it. Everything
 * about WHICH board and WHICH columns lives in `./help-desk.ts`.
 *
 * Auth is a single workspace-level personal API token (`MONDAY_API_TOKEN`,
 * from monday → Developers → My Access Tokens). There's no per-account
 * credential here the way there is for GoHighLevel: the help desk is one
 * internal Oz board, not a per-client integration.
 */

import {
  HELP_DESK_BOARD_ID,
  HELP_DESK_COLUMNS,
  HELP_DESK_GROUP_ID,
} from '@/lib/support/help-desk';

const API_URL = 'https://api.monday.com/v2';
const FILE_API_URL = 'https://api.monday.com/v2/file';
/** Pinned per monday's guidance — an unversioned call floats onto whatever is current. */
const API_VERSION = '2024-10';
const REQUEST_TIMEOUT_MS = 20_000;

export type MondayErrorCode = 'not_configured' | 'api_error';

export class MondayError extends Error {
  code: MondayErrorCode;
  httpStatus?: number;
  constructor(message: string, code: MondayErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'MondayError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** True when a token is present — callers use this to pick the email fallback. */
export function isMondayConfigured(): boolean {
  return Boolean(process.env.MONDAY_API_TOKEN?.trim());
}

function requireToken(): string {
  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) {
    throw new MondayError(
      'monday.com is not connected — set MONDAY_API_TOKEN.',
      'not_configured',
    );
  }
  return token;
}

export function helpDeskBoardId(): string {
  return process.env.MONDAY_HELP_DESK_BOARD_ID?.trim() || HELP_DESK_BOARD_ID;
}

export function helpDeskGroupId(): string {
  return process.env.MONDAY_HELP_DESK_GROUP_ID?.trim() || HELP_DESK_GROUP_ID;
}

/**
 * monday answers 200 OK with an `errors` array for GraphQL-level failures
 * (bad column value, missing permission), so a status check alone isn't enough.
 */
async function mondayRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = requireToken();

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MondayError(
      `Could not reach monday.com: ${err instanceof Error ? err.message : String(err)}`,
      'api_error',
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: T; errors?: { message?: string }[]; error_message?: string }
    | null;

  if (!res.ok) {
    const detail = body?.error_message || body?.errors?.[0]?.message || res.statusText;
    throw new MondayError(`monday.com returned ${res.status}: ${detail}`, 'api_error', res.status);
  }
  if (body?.errors?.length) {
    throw new MondayError(
      `monday.com rejected the request: ${body.errors.map((e) => e.message).join('; ')}`,
      'api_error',
    );
  }
  if (!body?.data) {
    throw new MondayError('monday.com returned an empty response.', 'api_error');
  }
  return body.data;
}

// ── Board label cache ────────────────────────────────────────────────────────
// The Location list is ~40 dealership labels that change a couple of times a
// year, so re-fetching it on every submission would be pure latency. Cached in
// process for 10 minutes; a stale entry only costs an unmatched Location, which
// falls back to "Other" with the real account name in the details body.

interface LabelCacheEntry {
  labels: Record<string, string[]>;
  expiresAt: number;
}
const LABEL_TTL_MS = 10 * 60 * 1000;
let labelCache: LabelCacheEntry | null = null;

interface BoardColumnsResponse {
  boards: { columns: { id: string; type: string; settings_str: string }[] }[] | null;
}

/**
 * Dropdown labels on the help desk board, keyed by column id.
 *
 * Returns `{}` rather than throwing if the read fails — a submission that can't
 * resolve its Location is still worth filing, so this must never be the thing
 * that loses someone's bug report.
 */
export async function getHelpDeskLabels(): Promise<Record<string, string[]>> {
  if (labelCache && labelCache.expiresAt > Date.now()) return labelCache.labels;

  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        columns { id type settings_str }
      }
    }
  `;

  try {
    const data = await mondayRequest<BoardColumnsResponse>(query, {
      boardId: [helpDeskBoardId()],
    });
    const columns = data.boards?.[0]?.columns ?? [];
    const labels: Record<string, string[]> = {};
    for (const column of columns) {
      if (column.type !== 'dropdown') continue;
      try {
        const settings = JSON.parse(column.settings_str) as {
          labels?: { label?: string; is_deactivated?: boolean }[];
        };
        labels[column.id] = (settings.labels ?? [])
          .filter((l) => !l.is_deactivated && typeof l.label === 'string' && l.label.trim())
          .map((l) => l.label!.trim());
      } catch {
        // Unparseable settings — skip this column rather than fail the read.
      }
    }
    labelCache = { labels, expiresAt: Date.now() + LABEL_TTL_MS };
    return labels;
  } catch {
    return labelCache?.labels ?? {};
  }
}

/** Test/ops helper — drops the cached label list. */
export function clearHelpDeskLabelCache(): void {
  labelCache = null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface CreatedItem {
  id: string;
  url: string;
}

/** Create one item in the help desk board's "New Requests" group. */
export async function createHelpDeskItem(input: {
  itemName: string;
  columnValues: Record<string, unknown>;
}): Promise<CreatedItem> {
  const query = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $itemName
        column_values: $columnValues
      ) { id url }
    }
  `;

  const data = await mondayRequest<{ create_item: { id: string; url: string } | null }>(query, {
    boardId: helpDeskBoardId(),
    groupId: helpDeskGroupId(),
    itemName: input.itemName,
    // column_values is a JSON *scalar* — monday wants a stringified object.
    columnValues: JSON.stringify(input.columnValues),
  });

  const item = data.create_item;
  if (!item?.id) {
    throw new MondayError('monday.com did not return the created item.', 'api_error');
  }
  return { id: item.id, url: item.url };
}

/**
 * Attach one file to an item's Attachments column.
 *
 * Uploads go to a different endpoint (`/v2/file`) as a GraphQL multipart
 * request: the `map` field wires the multipart part named `variables[file]`
 * onto the `$file` variable. Uploading via the normal JSON endpoint silently
 * does nothing.
 */
export async function addFileToHelpDeskItem(itemId: string, file: File): Promise<void> {
  const token = requireToken();
  const query = `
    mutation ($itemId: ID!, $columnId: String!, $file: File!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id }
    }
  `;

  const form = new FormData();
  form.append(
    'query',
    query.replace(/\s+/g, ' ').trim(),
  );
  form.append(
    'variables',
    JSON.stringify({ itemId, columnId: HELP_DESK_COLUMNS.attachments, file: null }),
  );
  form.append('map', JSON.stringify({ 'variables[file]': 'variables.file' }));
  form.append('variables[file]', file, file.name);

  let res: Response;
  try {
    res = await fetch(FILE_API_URL, {
      method: 'POST',
      headers: { Authorization: token, 'API-Version': API_VERSION },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MondayError(
      `Could not upload "${file.name}" to monday.com: ${err instanceof Error ? err.message : String(err)}`,
      'api_error',
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: unknown; errors?: { message?: string }[]; error_message?: string }
    | null;

  if (!res.ok || body?.errors?.length) {
    const detail =
      body?.error_message || body?.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new MondayError(
      `monday.com rejected the attachment "${file.name}": ${detail}`,
      'api_error',
      res.status,
    );
  }
}
