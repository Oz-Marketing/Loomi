import { DELIVERABLES_BOARD_ID } from '../monday-board';

/**
 * A stand-in for monday, for the drafting DB tests: answers the queries
 * monday-board.ts makes from an in-memory board, serves creative bytes, and
 * records every write so a test can assert exactly what Loomi posted.
 */

export interface StubSubitem {
  id: string;
  name: string;
  approved: boolean;
  /** Design Assets, by monday asset id → file name. */
  assets: Record<string, string>;
  clients: string[];
  coop?: 'Yes' | 'No' | 'Compliance Check';
  draftFiles?: string[];
  templateUrl?: string | null;
  proofStatus?: string;
  projectName?: string;
}

export interface StubBoard {
  subitems: StubSubitem[];
  /** Bytes served for each asset id. */
  creative: Record<string, string>;
}

export interface StubWrites {
  updates: { itemId: string; body: string }[];
  links: { itemId: string; columnId: string; value: string }[];
  uploads: { itemId: string; columnId: string; name: string }[];
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function rawSubitem(s: StubSubitem) {
  return {
    id: s.id,
    name: s.name,
    updated_at: '2026-10-09T17:00:00Z',
    board: { id: DELIVERABLES_BOARD_ID },
    column_values: [
      { id: 'color_mm7zba2g', text: '', label: s.approved ? 'Approved' : 'Waiting on Design' },
      {
        id: 'file_mm7z1a42',
        text: '',
        files: Object.entries(s.assets).map(([id, name]) => ({
          asset: { id, name, file_extension: name.slice(name.lastIndexOf('.')), file_size: 9 },
        })),
      },
      { id: 'file_mm7z7hyz', text: '', files: (s.draftFiles ?? []).map((name, i) => ({ asset: { id: `df${i}`, name } })) },
      { id: 'link_mm7zjhj9', text: '', url: s.templateUrl ?? null },
      { id: 'color_mm79xe71', text: '', label: s.proofStatus ?? 'No proof' },
      { id: 'link_mm79djf1', text: '', url: null },
      { id: 'date_mm7z9v44', text: '', date: '' },
    ],
    parent_item: {
      id: `p-${s.id}`,
      name: s.projectName ?? 'October Offers',
      column_values: [
        {
          id: 'lookup_mm7pw1hd',
          text: null,
          display_value: s.clients.join(', '),
          mirrored_items: [{ mirrored_value: { values: s.clients.map((label) => ({ label })) } }],
        },
        { id: 'lookup_mm7phjm0', text: null, display_value: s.coop ?? 'No' },
      ],
    },
  };
}

export function mondayStub(board: StubBoard): { fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>; writes: StubWrites } {
  const writes: StubWrites = { updates: [], links: [], uploads: [] };
  const find = (id: string) => board.subitems.find((s) => s.id === id);

  async function fetchImpl(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const href = String(url);
    if (href.startsWith('https://files.example/')) {
      const id = href.slice('https://files.example/'.length);
      return new Response(board.creative[id] ?? '', { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (href === 'https://api.monday.com/v2/file') {
      const form = init?.body as FormData;
      const variables = JSON.parse(String(form.get('variables')));
      const file = form.get('variables[file]') as File;
      writes.uploads.push({ itemId: variables.itemId, columnId: variables.columnId, name: file.name });
      return json({ data: { add_file_to_column: { id: `upload-${writes.uploads.length}` } } });
    }

    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    if (query.includes('create_update')) {
      writes.updates.push({ itemId: String(variables.itemId), body: String(variables.body) });
      return json({ data: { create_update: { id: `update-${writes.updates.length}` } } });
    }
    if (query.includes('change_column_value')) {
      writes.links.push({ itemId: String(variables.itemId), columnId: String(variables.columnId), value: String(variables.value) });
      return json({ data: { change_column_value: { id: String(variables.itemId) } } });
    }
    if (query.includes('assets(ids:')) {
      const ids = variables.ids as string[];
      return json({ data: { assets: ids.map((id) => ({ id, name: `${id}.png`, file_size: 9, public_url: `https://files.example/${id}` })) } });
    }
    if (query.includes('items_page')) {
      const items = board.subitems.filter((s) => s.approved).map(rawSubitem);
      return json({ data: { boards: [{ items_page: { cursor: null, items } }] } });
    }
    const ids = (variables.ids as string[] | undefined) ?? [];
    const items = ids.map(find).filter((s): s is StubSubitem => Boolean(s)).map(rawSubitem);
    return json({ data: { items } });
  }

  return { fetch: fetchImpl, writes };
}
