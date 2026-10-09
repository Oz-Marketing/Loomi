import { MondayError, mondayRequest, mondayUploadFile } from '@/lib/monday/client';

/**
 * The Development Projects board, as email drafting reads and writes it.
 *
 *   https://oz-marketing.monday.com/boards/18431636272   (projects — the request)
 *   https://oz-marketing.monday.com/boards/18431636469   (subitems — one per deliverable)
 *
 * A project is one request ("Q4 YAG Branding Conquest Campaign"); each subitem
 * is one deliverable ("Email Blast 1"). Drafting works on ONE subitem at a time
 * and reads its parent for the request fields.
 *
 * ── WHO OWNS WHICH COLUMN ──
 *
 *   Design Assets        design team     the approved creative — drafting's INPUT
 *   Assets Approved      design team     "Approved" = ready to draft (the trigger)
 *   Draft Files          LOOMI           the rendered draft, PNG + HTML (OUTPUT)
 *   Proof Status         PageProof sync  "Approved" is final — Loomi only READS it
 *   Proof URL            PageProof sync  read only
 *   Proof Approval Date  PageProof sync  read only
 *
 * Proofs are started by a person from the subitem; the monday ↔ PageProof
 * integration writes the outcome back. A Loomi write to any of the last three
 * would fight that sync, so this module has exactly ONE write, with the column
 * fixed inside it — `uploadDraftFile` — and `monday-board.test.ts` fails if a
 * second one appears.
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
} as const;

/** The one column drafting writes. */
export const DRAFT_OUTPUT_COLUMN = DELIVERABLE_COLUMNS.draftFiles;

/** Written by the monday ↔ PageProof sync. Loomi reads these and never writes them. */
export const PAGEPROOF_OWNED_COLUMNS = [
  DELIVERABLE_COLUMNS.proofStatus,
  DELIVERABLE_COLUMNS.proofUrl,
  DELIVERABLE_COLUMNS.proofApprovalDate,
] as const;

/** Assets Approved → "Approved" is label index 1 on the board. */
const ASSETS_APPROVED_INDEX = 1;
export const ASSETS_APPROVED_LABEL = 'Approved';
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
}

export interface Deliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  assetsApproved: boolean;
  designAssets: DeliverableFile[];
  draftFiles: DeliverableFile[];
  proof: ProofState;
  /** Null only for an orphaned subitem, which drafting can't use. */
  project: ProjectRequest | null;
}

export interface ReadyDeliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  projectId: string | null;
  projectName: string | null;
  hasDraftFiles: boolean;
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
  files?: RawFile[] | null;
}

interface RawItem {
  id: string;
  name: string;
  board?: { id: string } | null;
  column_values: RawColumnValue[];
  parent_item?: { id: string; name: string; column_values: RawColumnValue[] } | null;
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
      clients: mirror(p.get(PROJECT_COLUMNS.client))
        .split(/,\s*/)
        .map((c) => c.trim())
        .filter(Boolean),
      coop: parseCoopFlag(mirror(p.get(PROJECT_COLUMNS.coop))),
      offerDisclaimer: mirror(p.get(PROJECT_COLUMNS.offerDisclaimer)),
      details: mirror(p.get(PROJECT_COLUMNS.details)),
      completeBy: mirror(p.get(PROJECT_COLUMNS.completeBy)) || null,
      runDates: mirror(p.get(PROJECT_COLUMNS.runDates)) || null,
      audience: mirror(p.get(PROJECT_COLUMNS.audience)),
      audienceDetails: mirror(p.get(PROJECT_COLUMNS.audienceDetails)),
      jobNumber: mirror(p.get(PROJECT_COLUMNS.jobNumber)) || null,
    };
  }
  return {
    id: raw.id,
    name: raw.name,
    kind: deliverableKind(raw.name),
    assetsApproved: cols.get(DELIVERABLE_COLUMNS.assetsApproved)?.label === ASSETS_APPROVED_LABEL,
    designAssets: files(cols.get(DELIVERABLE_COLUMNS.designAssets)),
    draftFiles: files(cols.get(DELIVERABLE_COLUMNS.draftFiles)),
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
  ... on MirrorValue { display_value }
  ... on FileValue { files { ... on FileAssetValue { asset { id name file_extension file_size } } } }
`;

const DELIVERABLE_QUERY = `
  query ($ids: [ID!]) {
    items(ids: $ids) {
      id
      name
      board { id }
      column_values(ids: ${JSON.stringify(Object.values(DELIVERABLE_COLUMNS))}) { ${COLUMN_VALUE_FIELDS} }
      parent_item {
        id
        name
        column_values(ids: ${JSON.stringify(Object.values(PROJECT_COLUMNS))}) { ${COLUMN_VALUE_FIELDS} }
      }
    }
  }
`;

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
  return parseDeliverable(raw);
}

/** Pages are 100 items; the board turns over long before this cap matters. */
const MAX_PAGES = 10;

/**
 * Every deliverable whose Assets Approved reads "Approved", any kind. The
 * caller decides what it can draft — the email slice takes `kind: 'email'`
 * without Draft Files yet.
 */
export async function listReadyDeliverables(): Promise<ReadyDeliverable[]> {
  const query = `
    query ($boardId: ID!, $columnId: ID!, $index: CompareValue!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(
          limit: 100
          cursor: $cursor
          query_params: { rules: [{ column_id: $columnId, compare_value: $index, operator: any_of }] }
        ) {
          cursor
          items {
            id
            name
            column_values(ids: ["${DRAFT_OUTPUT_COLUMN}"]) { ${COLUMN_VALUE_FIELDS} }
            parent_item { id name }
          }
        }
      }
    }
  `;
  type Page = {
    boards: { items_page: { cursor: string | null; items: RawItem[] } }[] | null;
  };

  const out: ReadyDeliverable[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: Page = await mondayRequest<Page>(query, {
      boardId: DELIVERABLES_BOARD_ID,
      columnId: DELIVERABLE_COLUMNS.assetsApproved,
      index: [ASSETS_APPROVED_INDEX],
      cursor,
    });
    const itemsPage = data.boards?.[0]?.items_page;
    for (const item of itemsPage?.items ?? []) {
      const cols = byId(item.column_values);
      out.push({
        id: item.id,
        name: item.name,
        kind: deliverableKind(item.name),
        projectId: item.parent_item?.id ?? null,
        projectName: item.parent_item?.name ?? null,
        hasDraftFiles: files(cols.get(DRAFT_OUTPUT_COLUMN)).length > 0,
      });
    }
    cursor = itemsPage?.cursor ?? null;
    if (!cursor) break;
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

// ── The one write ────────────────────────────────────────────────────────────

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
      `Set ${WRITE_ALLOWLIST_ENV} to the subitem you nominated before writing Draft Files from a non-production run.`,
      'api_error',
    );
  }
}

/**
 * Attach one rendered draft file (the PNG or the HTML) to the deliverable's
 * Draft Files column. The column is fixed here, not passed in: this is the only
 * monday write drafting makes.
 */
export async function uploadDraftFile(subitemId: string, file: File): Promise<{ assetId: string | null }> {
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
  return mondayUploadFile({ itemId: subitemId, columnId: DRAFT_OUTPUT_COLUMN, file });
}
