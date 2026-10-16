import { DELIVERABLES_BOARD_ID } from '../monday-board';

/**
 * A stand-in for monday, for the drafting DB tests: answers the queries
 * monday-board.ts makes from an in-memory board, serves creative bytes, and
 * records every write so a test can assert exactly what Loomi posted.
 */

export interface StubSubitem {
  id: string;
  name: string;
  /** Design has uploaded finals: the project's Approved Design carries `assets`. */
  approved: boolean;
  /** Design's approved files behind the project's Approved Design mirror, by monday asset id → file name. */
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
  /** Bytes served for each asset id — a string, or a real zip's bytes. */
  creative: Record<string, string | Buffer>;
}

export interface StubWrites {
  updates: { itemId: string; body: string }[];
  links: { itemId: string; columnId: string; value: string }[];
  uploads: { itemId: string; columnId: string; name: string }[];
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** The intake column design's files sit in, on every rep board in the stub. */
const INTAKE_COLUMN = 'mirror_mkm35fxz';
const intakeId = (s: StubSubitem) => `i-${s.id}`;

function fileValues(s: StubSubitem) {
  return Object.entries(s.assets).map(([id, name]) => ({
    asset: { id, name, file_extension: name.slice(name.lastIndexOf('.')), file_size: 9 },
  }));
}

function projectColumns(s: StubSubitem) {
  return [
    {
      id: 'lookup_mm7pw1hd',
      text: null,
      display_value: s.clients.join(', '),
      mirrored_items: [{ mirrored_value: { values: s.clients.map((label) => ({ label })) } }],
    },
    { id: 'lookup_mm7phjm0', text: null, display_value: s.coop ?? 'No' },
    {
      id: 'lookup_mm7zrfjk',
      text: null,
      display_value: '',
      mirrored_items: s.approved && Object.keys(s.assets).length ? [{ linked_item: { id: intakeId(s) } }] : [],
    },
  ];
}

function subitemColumns(s: StubSubitem) {
  return [
    { id: 'file_mm7z7hyz', text: '', files: (s.draftFiles ?? []).map((name, i) => ({ asset: { id: `df${i}`, name } })) },
    { id: 'link_mm7zjhj9', text: '', url: s.templateUrl ?? null },
    { id: 'color_mm79xe71', text: '', label: s.proofStatus ?? 'No proof' },
    { id: 'link_mm79djf1', text: '', url: null },
    { id: 'date_mm7z9v44', text: '', date: '' },
  ];
}

/** Each stub subitem is the only deliverable on its own project. */
function rawSubitem(s: StubSubitem) {
  return {
    id: s.id,
    name: s.name,
    updated_at: '2026-10-09T17:00:00Z',
    board: { id: DELIVERABLES_BOARD_ID },
    column_values: subitemColumns(s),
    parent_item: {
      id: `p-${s.id}`,
      name: s.projectName ?? 'October Offers',
      column_values: projectColumns(s),
      subitems: [{ id: s.id, name: s.name }],
    },
  };
}

function rawProject(s: StubSubitem) {
  return {
    id: `p-${s.id}`,
    name: s.projectName ?? 'October Offers',
    column_values: projectColumns(s),
    subitems: [{ id: s.id, name: s.name, updated_at: '2026-10-09T17:00:00Z', column_values: subitemColumns(s) }],
  };
}

export function mondayStub(board: StubBoard): { fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>; writes: StubWrites } {
  const writes: StubWrites = { updates: [], links: [], uploads: [] };
  const find = (id: string) => board.subitems.find((s) => s.id === id);

  async function fetchImpl(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const href = String(url);
    if (href.startsWith('https://files.example/')) {
      const id = href.slice('https://files.example/'.length);
      const body = board.creative[id] ?? '';
      return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200, headers: { 'Content-Type': 'image/png' } });
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
    if (query.includes('settings_str')) {
      const settings = { displayed_linked_columns: { '18414976097': [INTAKE_COLUMN] } };
      return json({ data: { boards: [{ columns: [{ settings_str: JSON.stringify(settings) }] }] } });
    }
    if (query.includes('items_page')) {
      return json({ data: { boards: [{ items_page: { cursor: null, items: board.subitems.map(rawProject) } }] } });
    }
    const ids = (variables.ids as string[] | undefined) ?? [];
    if (ids.length && ids.every((id) => id.startsWith('i-'))) {
      const items = board.subitems
        .filter((s) => ids.includes(intakeId(s)))
        .map((s) => ({ id: intakeId(s), column_values: [{ id: INTAKE_COLUMN, mirrored_items: [{ mirrored_value: { files: fileValues(s) } }] }] }));
      return json({ data: { items } });
    }
    const items = ids.map(find).filter((s): s is StubSubitem => Boolean(s)).map(rawSubitem);
    return json({ data: { items } });
  }

  return { fetch: fetchImpl, writes };
}
