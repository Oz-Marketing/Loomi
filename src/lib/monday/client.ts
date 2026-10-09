/**
 * monday.com transport — the one place that talks to the monday API.
 *
 * Server-only — it holds the API token. It knows nothing about any particular
 * board: WHICH board and WHICH columns belong to the feature that uses them
 * (`@/lib/support/help-desk` for the help desk, `@/lib/drafting/monday-board`
 * for email drafting). Keeping the transport separate is what lets a feature
 * module state, in one file, exactly which columns it is allowed to write.
 *
 * Auth is a single workspace-level personal API token (`MONDAY_API_TOKEN`,
 * from monday → Developers → My Access Tokens). There's no per-account
 * credential here the way there is for GoHighLevel: these are internal Oz
 * boards, not a per-client integration.
 */

const API_URL = 'https://api.monday.com/v2';
const FILE_API_URL = 'https://api.monday.com/v2/file';
/** Pinned per monday's guidance — an unversioned call floats onto whatever is current. */
const API_VERSION = '2024-10';
const REQUEST_TIMEOUT_MS = 20_000;
/** Design files are large and the signed URL points at S3, not the API. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/**
 * Refuse anything bigger. An approved email creative is a PNG or JPG of a few
 * MB; a 200 MB layered PSD is not something drafting can read, and pulling it
 * into memory on a 2 GB droplet is how the web process gets killed.
 */
export const MAX_ASSET_BYTES = 40 * 1024 * 1024;

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

/** True when a token is present — callers use this to pick a fallback. */
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

/**
 * One GraphQL request.
 *
 * monday answers 200 OK with an `errors` array for GraphQL-level failures
 * (bad column value, missing permission), so a status check alone isn't enough.
 */
export async function mondayRequest<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
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

/**
 * Attach one file to a file column on an item.
 *
 * Uploads go to a different endpoint (`/v2/file`) as a GraphQL multipart
 * request: the `map` field wires the multipart part named `variables[file]`
 * onto the `$file` variable. Uploading via the normal JSON endpoint silently
 * does nothing.
 *
 * Generic on purpose, and therefore NOT what a feature should call directly
 * when its write scope matters — wrap it with the column fixed, the way
 * `uploadDraftFile` does, so the allowed column is stated once.
 */
export async function mondayUploadFile(input: {
  itemId: string;
  columnId: string;
  file: File;
}): Promise<{ assetId: string | null }> {
  const { itemId, columnId, file } = input;
  const token = requireToken();
  const query = `
    mutation ($itemId: ID!, $columnId: String!, $file: File!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id }
    }
  `;

  const form = new FormData();
  form.append('query', query.replace(/\s+/g, ' ').trim());
  form.append('variables', JSON.stringify({ itemId, columnId, file: null }));
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
    | {
        data?: { add_file_to_column?: { id?: string } | null };
        errors?: { message?: string }[];
        error_message?: string;
      }
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
  return { assetId: body?.data?.add_file_to_column?.id ?? null };
}

export interface MondayAssetFile {
  id: string;
  name: string;
  bytes: Buffer;
  contentType: string | null;
}

interface AssetLookup {
  assets: { id: string; name: string; file_size: number | null; public_url: string | null }[] | null;
}

/**
 * Download one asset's bytes.
 *
 * `public_url` is a pre-signed S3 link that monday mints on request and expires
 * after about an hour, so it is fetched here, immediately, and never stored —
 * a URL saved for later is a URL that 403s later.
 */
export async function downloadMondayAsset(assetId: string): Promise<MondayAssetFile> {
  const data = await mondayRequest<AssetLookup>(
    `query ($ids: [ID!]!) { assets(ids: $ids) { id name file_size public_url } }`,
    { ids: [assetId] },
  );
  const asset = data.assets?.[0];
  if (!asset?.public_url) {
    throw new MondayError(`monday.com has no downloadable file for asset ${assetId}.`, 'api_error');
  }
  if (asset.file_size != null && asset.file_size > MAX_ASSET_BYTES) {
    throw new MondayError(
      `"${asset.name}" is ${Math.round(asset.file_size / 1024 / 1024)} MB — export a flattened PNG or JPG under ${MAX_ASSET_BYTES / 1024 / 1024} MB.`,
      'api_error',
    );
  }

  let res: Response;
  try {
    res = await fetch(asset.public_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw new MondayError(
      `Could not download "${asset.name}" from monday.com: ${err instanceof Error ? err.message : String(err)}`,
      'api_error',
    );
  }
  if (!res.ok) {
    throw new MondayError(
      `Downloading "${asset.name}" from monday.com failed with ${res.status}.`,
      'api_error',
      res.status,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new MondayError(`"${asset.name}" is larger than drafting accepts.`, 'api_error');
  }
  return { id: asset.id, name: asset.name, bytes, contentType: res.headers.get('content-type') };
}
