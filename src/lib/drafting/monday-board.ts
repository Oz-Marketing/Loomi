import { MondayError, mondayRequest, mondayUploadFile } from '@/lib/monday/client';
import { subitemClient } from './approved-files';

/**
 * The Development Projects board, as email drafting reads and writes it.
 *
 *   https://oz-marketing.monday.com/boards/18431636272   (projects — the request)
 *   https://oz-marketing.monday.com/boards/18431636469   (subitems — one per deliverable)
 *
 * A project is one request ("Q4 YAG Branding Conquest Campaign"); each subitem
 * is one deliverable for one client ("Email Blast 1 - Young Powersports Euro").
 * Drafting works on ONE subitem at a time and reads its parent for the request
 * fields.
 *
 * ── WHO OWNS WHICH COLUMN ──
 *
 *   Approved Design      design team     on the PROJECT: every final graphic for the
 *                                        request, mirrored from design's own Approved
 *                                        column — drafting's INPUT and its trigger
 *   Draft Files          LOOMI           the rendered draft, PNG + HTML
 *   Loomi Template       LOOMI           link to the draft's template in Loomi
 *   Proof Status         PageProof sync  "Approved" is final — Loomi only READS it
 *   Proof URL            PageProof sync  read only
 *   Proof Approval Date  PageProof sync  read only
 *
 * Approved Design is a mirror of a mirror: design's Approved file column →
 * the rep's intake board ("Approved Design", per rep board) → this project.
 * monday answers a two-level mirror query with an internal error, so the files
 * are read a hop at a time: the project's mirror names the intake item, and
 * the intake item's mirror holds design's files. Checked against the live
 * boards 2026-10-15, including downloading a 12 MB zip through the chain.
 *
 * The subitem's own Design Assets and Assets Approved columns predate this and
 * are no longer read.
 *
 * Loomi also posts UPDATES on the subitem: the draft's link, what it read off the
 * creative, and its notes — or why it couldn't draft.
 *
 * Proofs are started by a person from the subitem; the monday ↔ PageProof
 * integration writes the outcome back. A Loomi write to any of the proof columns
 * would fight that sync, so this module has exactly three writes — Draft Files,
 * the Loomi Template link, an update — each with its target fixed inside it, and
 * `monday-board.test.ts` fails if a fourth appears.
 */

export const DEV_PROJECTS_BOARD_ID = '18431636272';
export const DELIVERABLES_BOARD_ID = '18431636469';

/** Columns on the deliverable (subitem) board. */
export const DELIVERABLE_COLUMNS = {
  owner: 'multiple_person_mm7v6rk2',
  taskStatus: 'color_mm79cjxv',
  designAssets: 'file_mm7z1a42',
  assetsApproved: 'color_mm7zba2g',
  draftFiles: 'file_mm7z7hyz',
  proofStatus: 'color_mm79xe71',
  proofUrl: 'link_mm79djf1',
  proofApprovalDate: 'date_mm7z9v44',
  loomiTemplate: 'link_mm7zjhj9',
} as const;

/**
 * Columns on the project (parent) board. Nearly all are MIRRORS of the rep's
 * intake board, so their value arrives as `display_value`, never `text`.
 */
export const PROJECT_COLUMNS = {
  client: 'lookup_mm7pw1hd',
  coop: 'lookup_mm7phjm0',
  offerDisclaimer: 'lookup_mm7p60ay',
  details: 'lookup_mm7p6kqj',
  completeBy: 'lookup_mm7p8b1x',
  runDates: 'lookup_mm7p67r1',
  audience: 'lookup_mm7p3p7s',
  audienceDetails: 'lookup_mm7pap3x',
  jobNumber: 'lookup_mm7parn0',
  /** Design's final graphics, mirrored through the rep's intake board. */
  approvedDesign: 'lookup_mm7zrfjk',
} as const;

/** The columns drafting writes. */
export const DRAFT_OUTPUT_COLUMN = DELIVERABLE_COLUMNS.draftFiles;
export const TEMPLATE_LINK_COLUMN = DELIVERABLE_COLUMNS.loomiTemplate;

/** Written by the monday ↔ PageProof sync. Loomi reads these and never writes them. */
export const PAGEPROOF_OWNED_COLUMNS = [
  DELIVERABLE_COLUMNS.proofStatus,
  DELIVERABLE_COLUMNS.proofUrl,
  DELIVERABLE_COLUMNS.proofApprovalDate,
] as const;

export const PROOF_APPROVED_LABEL = 'Approved';

// ── Types ────────────────────────────────────────────────────────────────────

export type DeliverableKind = 'email' | 'text' | 'landing_page' | 'other';

/**
 * The project's Co-op flag, mirrored from the rep's "Co-Op Request" status:
 * Yes / No / Compliance Check, or nothing when the rep left it blank.
 */
export type CoopFlag = 'yes' | 'no' | 'compliance_check' | 'unset';

export interface DeliverableFile {
  assetId: string;
  name: string;
  extension: string;
  sizeBytes: number | null;
}

export interface ProofState {
  status: string | null;
  url: string | null;
  /** Proof Approval Date, `YYYY-MM-DD`. */
  approvedOn: string | null;
  /** Proof Status reads "Approved" — the draft is final. */
  approved: boolean;
}

/** The request, as the parent project carries it. */
export interface ProjectRequest {
  id: string;
  name: string;
  /** The Client mirror, split — one request can name several stores. */
  clients: string[];
  coop: CoopFlag;
  offerDisclaimer: string;
  details: string;
  /** `YYYY-MM-DD`. */
  completeBy: string | null;
  /** As monday renders it: "2026-11-01 - 2026-12-31". */
  runDates: string | null;
  audience: string;
  audienceDetails: string;
  jobNumber: string | null;
  /** Every final graphic design approved for the request — images and zips, all channels. */
  approvedFiles: DeliverableFile[];
  /** All the project's deliverables, this one included. */
  subitems: { id: string; name: string }[];
}

export interface Deliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  /** ISO time of the subitem's last change on monday. */
  updatedAt: string | null;
  draftFiles: DeliverableFile[];
  /** The Loomi Template link, once Loomi has written one. */
  templateUrl: string | null;
  proof: ProofState;
  /** Null only for an orphaned subitem, which drafting can't use. */
  project: ProjectRequest | null;
}

export interface ReadyDeliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  /** ISO time of the subitem's last change — what tells a fixed deliverable from a stale one. */
  updatedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  /**
   * The store this deliverable is for, when it can be told — `[store]` — else
   * every client the project names, which the intake reports as ambiguous.
   */
  clients: string[];
  coop: CoopFlag;
  /** The project's approved graphics — what the poller fingerprints. */
  approvedAssetIds: string[];
  hasDraftFiles: boolean;
  hasTemplateLink: boolean;
}

// ── Parsing (pure) ───────────────────────────────────────────────────────────

/** Subitems are named for the work: "Email Blast 1", "Text Blast 2", "Landing Page 1". */
export function deliverableKind(name: string): DeliverableKind {
  const n = name.trim().toLowerCase();
  if (n.startsWith('email')) return 'email';
  if (n.startsWith('text')) return 'text';
  if (n.startsWith('landing page')) return 'landing_page';
  return 'other';
}

export function parseCoopFlag(display: string | null | undefined): CoopFlag {
  const v = (display ?? '').trim().toLowerCase();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  if (v === 'compliance check') return 'compliance_check';
  return 'unset';
}

interface RawFile {
  asset?: {
    id: string;
    name: string;
    file_extension?: string | null;
    file_size?: number | null;
  } | null;
}

interface RawColumnValue {
  id: string;
  text?: string | null;
  label?: string | null;
  url?: string | null;
  date?: string | null;
  display_value?: string | null;
  /** A mirror's source values, structured — how a dropdown's labels survive intact. */
  mirrored_items?: {
    linked_item?: { id: string } | null;
    mirrored_value?: { values?: { label?: string | null }[] | null; files?: RawFile[] | null } | null;
  }[] | null;
  files?: RawFile[] | null;
}

interface RawItem {
  id: string;
  name: string;
  updated_at?: string | null;
  board?: { id: string } | null;
  column_values: RawColumnValue[];
  parent_item?: { id: string; name: string; column_values: RawColumnValue[]; subitems?: { id: string; name: string }[] | null } | null;
  subitems?: { id: string; name: string; column_values: RawColumnValue[] }[] | null;
}

function byId(values: RawColumnValue[]): Map<string, RawColumnValue> {
  return new Map(values.map((v) => [v.id, v]));
}

function files(cv: RawColumnValue | undefined): DeliverableFile[] {
  return (cv?.files ?? [])
    .map((f) => f.asset)
    .filter((a): a is NonNullable<RawFile['asset']> => Boolean(a?.id))
    .map((a) => ({
      assetId: a.id,
      name: a.name,
      extension: (a.file_extension ?? '').toLowerCase(),
      sizeBytes: a.file_size ?? null,
    }));
}

/** A mirror's value is in `display_value`; `text` is always null for one. */
function mirror(cv: RawColumnValue | undefined): string {
  return (cv?.display_value ?? cv?.text ?? '').trim();
}

/**
 * The stores a Client mirror names: "Young Powersports Ogden, Young Powersports Euro".
 *
 * Read from the mirror's STRUCTURED source values, not by splitting its display
 * text: monday joins labels with ", ", and "Young Caring For Our Young, Inc." is
 * one store that a split turns into two. The text split is only a fallback for a
 * mirror that comes back without its source values.
 */
export function clientLabels(cv: RawColumnValue | undefined): string[] {
  const structured = (cv?.mirrored_items ?? [])
    .flatMap((m) => m.mirrored_value?.values ?? [])
    .map((v) => v.label?.trim() ?? '')
    .filter(Boolean);
  const labels = structured.length
    ? structured
    : mirror(cv)
        .split(/,\s*/)
        .map((c) => c.trim())
        .filter(Boolean);
  return [...new Set(labels)];
}

function proofState(cols: Map<string, RawColumnValue>): ProofState {
  const status = cols.get(DELIVERABLE_COLUMNS.proofStatus)?.label ?? null;
  return {
    status,
    url: cols.get(DELIVERABLE_COLUMNS.proofUrl)?.url || null,
    approvedOn: cols.get(DELIVERABLE_COLUMNS.proofApprovalDate)?.date || null,
    approved: status === PROOF_APPROVED_LABEL,
  };
}

export function parseDeliverable(raw: RawItem): Deliverable {
  const cols = byId(raw.column_values);
  const parent = raw.parent_item;
  let project: ProjectRequest | null = null;
  if (parent) {
    const p = byId(parent.column_values);
    project = {
      id: parent.id,
      name: parent.name,
      clients: clientLabels(p.get(PROJECT_COLUMNS.client)),
      coop: parseCoopFlag(mirror(p.get(PROJECT_COLUMNS.coop))),
      offerDisclaimer: mirror(p.get(PROJECT_COLUMNS.offerDisclaimer)),
      details: mirror(p.get(PROJECT_COLUMNS.details)),
      completeBy: mirror(p.get(PROJECT_COLUMNS.completeBy)) || null,
      runDates: mirror(p.get(PROJECT_COLUMNS.runDates)) || null,
      audience: mirror(p.get(PROJECT_COLUMNS.audience)),
      audienceDetails: mirror(p.get(PROJECT_COLUMNS.audienceDetails)),
      jobNumber: mirror(p.get(PROJECT_COLUMNS.jobNumber)) || null,
      // Filled by getDeliverable, which follows the mirror to design's files.
      approvedFiles: [],
      subitems: (parent.subitems ?? []).map((x) => ({ id: x.id, name: x.name })),
    };
  }
  return {
    id: raw.id,
    name: raw.name,
    kind: deliverableKind(raw.name),
    updatedAt: raw.updated_at ?? null,
    draftFiles: files(cols.get(DELIVERABLE_COLUMNS.draftFiles)),
    templateUrl: cols.get(TEMPLATE_LINK_COLUMN)?.url || null,
    proof: proofState(cols),
    project,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const COLUMN_VALUE_FIELDS = `
  id
  text
  ... on StatusValue { label }
  ... on LinkValue { url }
  ... on DateValue { date }
  ... on MirrorValue { display_value mirrored_items { linked_item { id } mirrored_value { ... on DropdownValue { values { label } } } } }
  ... on FileValue { files { ... on FileAssetValue { asset { id name file_extension file_size } } } }
`;

const DELIVERABLE_QUERY = `
  query ($ids: [ID!]) {
    items(ids: $ids) {
      id
      name
      updated_at
      board { id }
      column_values(ids: ${JSON.stringify(Object.values(DELIVERABLE_COLUMNS))}) { ${COLUMN_VALUE_FIELDS} }
      parent_item {
        id
        name
        column_values(ids: ${JSON.stringify(Object.values(PROJECT_COLUMNS))}) { ${COLUMN_VALUE_FIELDS} }
        subitems { id name }
      }
    }
  }
`;

/** The intake items a project's Approved Design mirror points at. */
export function approvedDesignSources(cv: RawColumnValue | undefined): string[] {
  return [...new Set((cv?.mirrored_items ?? []).map((m) => m.linked_item?.id).filter((id): id is string => !!id))];
}

/** Which column on each rep intake board holds design's files — from the mirror's own settings. */
let intakeColumnsCache: { at: number; byBoard: Record<string, string[]> } | null = null;
const INTAKE_COLUMNS_TTL_MS = 10 * 60 * 1000;

export function parseIntakeColumns(settingsStr: string | null | undefined): Record<string, string[]> {
  try {
    const settings = JSON.parse(settingsStr ?? '{}') as { displayed_linked_columns?: Record<string, string[]> };
    return settings.displayed_linked_columns ?? {};
  } catch {
    return {};
  }
}

async function intakeColumns(): Promise<Record<string, string[]>> {
  if (intakeColumnsCache && Date.now() - intakeColumnsCache.at < INTAKE_COLUMNS_TTL_MS) return intakeColumnsCache.byBoard;
  const data = await mondayRequest<{ boards: { columns: { settings_str: string | null }[] }[] | null }>(
    `query ($boardId: ID!, $columnId: String!) { boards(ids: [$boardId]) { columns(ids: [$columnId]) { settings_str } } }`,
    { boardId: DEV_PROJECTS_BOARD_ID, columnId: PROJECT_COLUMNS.approvedDesign },
  );
  const byBoard = parseIntakeColumns(data.boards?.[0]?.columns?.[0]?.settings_str);
  intakeColumnsCache = { at: Date.now(), byBoard };
  return byBoard;
}

/** Design's approved files behind each intake item. Missing items map to nothing. */
export async function approvedFilesByIntakeItem(intakeIds: string[]): Promise<Map<string, DeliverableFile[]>> {
  const out = new Map<string, DeliverableFile[]>();
  if (intakeIds.length === 0) return out;
  const columnIds = [...new Set(Object.values(await intakeColumns()).flat())];
  if (columnIds.length === 0) return out;
  const query = `
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        column_values(ids: ${JSON.stringify(columnIds)}) {
          id
          ... on MirrorValue {
            mirrored_items {
              mirrored_value { ... on FileValue { files { ... on FileAssetValue { asset { id name file_extension file_size } } } } }
            }
          }
        }
      }
    }
  `;
  for (let i = 0; i < intakeIds.length; i += 100) {
    const data = await mondayRequest<{ items: RawItem[] | null }>(query, { ids: intakeIds.slice(i, i + 100) });
    for (const item of data.items ?? []) {
      const found = item.column_values.flatMap((cv) =>
        (cv.mirrored_items ?? []).flatMap((m) => files({ id: cv.id, files: m.mirrored_value?.files ?? [] })),
      );
      out.set(item.id, dedupeFiles(found));
    }
  }
  return out;
}

function dedupeFiles(list: DeliverableFile[]): DeliverableFile[] {
  return list.filter((f, i) => list.findIndex((g) => g.assetId === f.assetId) === i);
}

function assertDeliverableBoard(item: { id: string; board?: { id: string } | null }): void {
  if (item.board?.id !== DELIVERABLES_BOARD_ID) {
    throw new MondayError(
      `monday item ${item.id} is not a Development Projects deliverable (board ${item.board?.id ?? 'unknown'}).`,
      'api_error',
    );
  }
}

/**
 * One deliverable and the request it belongs to, or null if monday has no
 * such item. Throws for an item on any other board, so a mistyped id can never
 * be drafted against someone else's request.
 */
export async function getDeliverable(subitemId: string): Promise<Deliverable | null> {
  const data = await mondayRequest<{ items: RawItem[] | null }>(DELIVERABLE_QUERY, {
    ids: [subitemId],
  });
  const raw = data.items?.[0];
  if (!raw) return null;
  assertDeliverableBoard(raw);
  const deliverable = parseDeliverable(raw);
  if (deliverable.project && raw.parent_item) {
    const sources = approvedDesignSources(byId(raw.parent_item.column_values).get(PROJECT_COLUMNS.approvedDesign));
    const byItem = await approvedFilesByIntakeItem(sources);
    deliverable.project.approvedFiles = dedupeFiles(sources.flatMap((id) => byItem.get(id) ?? []));
  }
  return deliverable;
}

/** Pages are 100 items; the board turns over long before this cap matters. */
const MAX_PAGES = 20;

/**
 * Every deliverable on a project whose Approved Design has files, any kind.
 * The caller decides what it can draft — the email slice takes `kind: 'email'`
 * without Draft Files yet.
 *
 * Reads every project: a mirror column can't be filtered on. Three requests a
 * page at most — the projects, their intake items' files — every five minutes.
 */
export async function listApprovedDeliverables(): Promise<ReadyDeliverable[]> {
  const query = `
    query ($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values(ids: ["${PROJECT_COLUMNS.client}", "${PROJECT_COLUMNS.coop}", "${PROJECT_COLUMNS.approvedDesign}"]) { ${COLUMN_VALUE_FIELDS} }
            subitems {
              id
              name
              updated_at
              column_values(ids: ["${DRAFT_OUTPUT_COLUMN}", "${TEMPLATE_LINK_COLUMN}"]) { ${COLUMN_VALUE_FIELDS} }
            }
          }
        }
      }
    }
  `;
  type Page = { boards: { items_page: { cursor: string | null; items: (RawItem & { subitems?: (RawItem)[] | null })[] } }[] | null };

  const projects: (RawItem & { subitems?: RawItem[] | null })[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: Page = await mondayRequest<Page>(query, { boardId: DEV_PROJECTS_BOARD_ID, cursor });
    const itemsPage = data.boards?.[0]?.items_page;
    for (const item of itemsPage?.items ?? []) {
      const sources = approvedDesignSources(byId(item.column_values).get(PROJECT_COLUMNS.approvedDesign));
      if (sources.length && (item.subitems ?? []).length) projects.push(item);
    }
    cursor = itemsPage?.cursor ?? null;
    if (!cursor) break;
  }

  const allSources = [...new Set(projects.flatMap((p) => approvedDesignSources(byId(p.column_values).get(PROJECT_COLUMNS.approvedDesign))))];
  const byItem = await approvedFilesByIntakeItem(allSources);

  const out: ReadyDeliverable[] = [];
  for (const project of projects) {
    const cols = byId(project.column_values);
    const approved = dedupeFiles(
      approvedDesignSources(cols.get(PROJECT_COLUMNS.approvedDesign)).flatMap((id) => byItem.get(id) ?? []),
    );
    if (approved.length === 0) continue;
    const clients = clientLabels(cols.get(PROJECT_COLUMNS.client));
    for (const sub of project.subitems ?? []) {
      const subCols = byId(sub.column_values);
      const store = subitemClient(sub.name, clients);
      out.push({
        id: sub.id,
        name: sub.name,
        kind: deliverableKind(sub.name),
        updatedAt: sub.updated_at ?? null,
        projectId: project.id,
        projectName: project.name,
        clients: store ? [store] : clients,
        coop: parseCoopFlag(mirror(cols.get(PROJECT_COLUMNS.coop))),
        approvedAssetIds: approved.map((f) => f.assetId),
        hasDraftFiles: files(subCols.get(DRAFT_OUTPUT_COLUMN)).length > 0,
        hasTemplateLink: Boolean(subCols.get(TEMPLATE_LINK_COLUMN)?.url),
      });
    }
  }
  return out;
}

/**
 * Proof outcome for each deliverable, as the PageProof sync last wrote it.
 * Missing ids are simply absent from the map.
 */
export async function getProofStates(subitemIds: string[]): Promise<Map<string, ProofState>> {
  const out = new Map<string, ProofState>();
  if (subitemIds.length === 0) return out;
  const query = `
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        board { id }
        column_values(ids: ${JSON.stringify(PAGEPROOF_OWNED_COLUMNS)}) { ${COLUMN_VALUE_FIELDS} }
      }
    }
  `;
  // monday caps `items(ids:)` at 100 per request.
  for (let i = 0; i < subitemIds.length; i += 100) {
    const data = await mondayRequest<{ items: RawItem[] | null }>(query, {
      ids: subitemIds.slice(i, i + 100),
    });
    for (const item of data.items ?? []) {
      if (item.board?.id !== DELIVERABLES_BOARD_ID) continue;
      out.set(item.id, proofState(byId(item.column_values)));
    }
  }
  return out;
}

// ── The writes ───────────────────────────────────────────────────────────────

/**
 * Comma-separated subitem ids drafting may write to. When set, every other
 * subitem is refused. Outside production it is REQUIRED: a local or test run
 * writes to the real board, so it may only touch a subitem someone nominated.
 */
const WRITE_ALLOWLIST_ENV = 'DRAFTING_MONDAY_WRITE_SUBITEMS';

export function assertDraftWriteAllowed(subitemId: string): void {
  const raw = process.env[WRITE_ALLOWLIST_ENV]?.trim();
  if (raw) {
    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(subitemId)) {
      throw new MondayError(
        `Subitem ${subitemId} isn't in ${WRITE_ALLOWLIST_ENV} — drafting only writes to nominated subitems here.`,
        'api_error',
      );
    }
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    throw new MondayError(
      `Set ${WRITE_ALLOWLIST_ENV} to the subitem you nominated before writing to monday from a non-production run.`,
      'api_error',
    );
  }
}

/** Every write starts here: a nominated subitem (outside production) on the deliverables board. */
async function assertWritableDeliverable(subitemId: string): Promise<void> {
  assertDraftWriteAllowed(subitemId);
  const data = await mondayRequest<{ items: { id: string; board: { id: string } | null }[] | null }>(
    `query ($ids: [ID!]) { items(ids: $ids) { id board { id } } }`,
    { ids: [subitemId] },
  );
  const item = data.items?.[0];
  if (!item) {
    throw new MondayError(`monday has no item ${subitemId}.`, 'api_error');
  }
  assertDeliverableBoard(item);
}

/** Attach one rendered draft file (the PNG or the HTML) to Draft Files. */
export async function uploadDraftFile(subitemId: string, file: File): Promise<{ assetId: string | null }> {
  await assertWritableDeliverable(subitemId);
  return mondayUploadFile({ itemId: subitemId, columnId: DRAFT_OUTPUT_COLUMN, file });
}

/** Point the Loomi Template column at the draft's template. */
export async function setTemplateLink(subitemId: string, url: string, text: string): Promise<void> {
  await assertWritableDeliverable(subitemId);
  await mondayRequest(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    {
      boardId: DELIVERABLES_BOARD_ID,
      itemId: subitemId,
      columnId: TEMPLATE_LINK_COLUMN,
      // A link column's value is a JSON scalar — monday wants it stringified.
      value: JSON.stringify({ url, text }),
    },
  );
}

/** Post an update on the subitem. `html` must already be escaped — see notes.ts. */
export async function postDraftUpdate(subitemId: string, html: string): Promise<{ updateId: string | null }> {
  await assertWritableDeliverable(subitemId);
  const data = await mondayRequest<{ create_update: { id: string } | null }>(
    `mutation ($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id } }`,
    { itemId: subitemId, body: html },
  );
  return { updateId: data.create_update?.id ?? null };
}
