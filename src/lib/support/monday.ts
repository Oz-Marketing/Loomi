/**
 * monday.com client for the in-app help desk.
 *
 * Server-only — it holds the API token. Scope is deliberately tiny: read a
 * board's dropdown labels, create one item, attach files to it. Everything
 * about WHICH board and WHICH columns lives in `./help-desk.ts`; the transport
 * itself (auth, errors, uploads) is shared in `@/lib/monday/client`.
 */

import {
  HELP_DESK_BOARD_ID,
  HELP_DESK_COLUMNS,
  HELP_DESK_GROUP_ID,
} from '@/lib/support/help-desk';
import { MondayError, mondayRequest, mondayUploadFile } from '@/lib/monday/client';

export { MondayError, isMondayConfigured, type MondayErrorCode } from '@/lib/monday/client';

export function helpDeskBoardId(): string {
  return process.env.MONDAY_HELP_DESK_BOARD_ID?.trim() || HELP_DESK_BOARD_ID;
}

export function helpDeskGroupId(): string {
  return process.env.MONDAY_HELP_DESK_GROUP_ID?.trim() || HELP_DESK_GROUP_ID;
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

/** Attach one file to an item's Attachments column. */
export async function addFileToHelpDeskItem(itemId: string, file: File): Promise<void> {
  await mondayUploadFile({ itemId, columnId: HELP_DESK_COLUMNS.attachments, file });
}
