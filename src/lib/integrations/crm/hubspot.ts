/**
 * HubSpot CRM client — pushes qualified Loomi contacts into HubSpot.
 *
 * Unlike the ADF providers (Tekion / VinSolutions), which email a lead
 * document to a CRM intake inbox, HubSpot is reached over its REST API. We
 * upsert the contact by email (idempotent — the same contact pushed twice
 * just updates the existing record), so the AT-LEAST-ONCE delivery semantics
 * in deliver.ts are safe here: a retry that already succeeded simply re-writes
 * the same properties. Optionally creates an associated deal in a configured
 * pipeline/stage so reps get a real opportunity, not just a contact.
 *
 * Auth is a HubSpot Private App access token (server-to-server, no OAuth
 * dance), stored encrypted on CrmDestination.accessToken and decrypted by the
 * worker before calling in here. This module never touches the DB or the
 * encryption helpers — it's a pure HTTP client + property mapper so it stays
 * easy to test and reason about.
 */
import type { Contact } from '@prisma/client';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * HubSpot-defined association type id for "deal → contact". Used when we
 * create a deal and associate it back to the upserted contact.
 */
const DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID = 3;

/**
 * Per-destination HubSpot settings, persisted as CrmDestination.config (JSON).
 * All optional — a bare connection just upserts the contact's standard props.
 */
export interface HubspotConfig {
  /**
   * Maps a Loomi Contact.customFields key → a HubSpot property name, e.g.
   * { practiceName: "company" }. Lets the operator forward dental-practice
   * fields without code changes.
   */
  fieldMap?: Record<string, string>;
  /** When BOTH are set, also create a deal in this pipeline/stage on push. */
  pipelineId?: string;
  stageId?: string;
  /** Prefix for the auto-created deal name (default "New consultation"). */
  dealNamePrefix?: string;
}

/**
 * Error from a HubSpot call. `retryable` tells deliver.ts whether to let
 * pg-boss back off and retry (transient: 429 / 5xx / network) or fail the
 * delivery terminally (config errors: 401 bad token, 403 missing scope, 400
 * bad request) — the same terminal-vs-retry split LeadEmailError gives the
 * ADF path.
 */
export class HubspotError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = 'HubspotError';
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/** Transient statuses worth retrying: rate-limit and server errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Parse the stored CrmDestination.config JSON into a typed HubspotConfig. */
export function parseHubspotConfig(value: unknown): HubspotConfig {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const cfg: HubspotConfig = {};
  if (v.fieldMap && typeof v.fieldMap === 'object') {
    const map: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.fieldMap as Record<string, unknown>)) {
      if (typeof val === 'string' && val.trim()) map[k] = val.trim();
    }
    cfg.fieldMap = map;
  }
  if (typeof v.pipelineId === 'string' && v.pipelineId.trim()) cfg.pipelineId = v.pipelineId.trim();
  if (typeof v.stageId === 'string' && v.stageId.trim()) cfg.stageId = v.stageId.trim();
  if (typeof v.dealNamePrefix === 'string' && v.dealNamePrefix.trim()) {
    cfg.dealNamePrefix = v.dealNamePrefix.trim();
  }
  return cfg;
}

/** True when the config asks us to create a deal alongside the contact. */
export function shouldCreateDeal(config: HubspotConfig): boolean {
  return Boolean(config.pipelineId && config.stageId);
}

type MappableContact = Pick<
  Contact,
  'email' | 'phone' | 'firstName' | 'lastName' | 'city' | 'state' | 'postalCode' | 'customFields'
>;

/**
 * Map a Loomi contact → HubSpot contact properties. Standard fields go to
 * HubSpot's well-known property names; any configured custom-field mappings
 * are layered on top. Empty values are dropped so we never blank out a
 * property HubSpot already has.
 */
export function buildHubspotProperties(
  contact: MappableContact,
  config: HubspotConfig,
): Record<string, string> {
  const props: Record<string, string> = {};
  const set = (key: string, value: unknown) => {
    const t = value == null ? '' : String(value).trim();
    if (t) props[key] = t;
  };

  set('email', contact.email);
  set('firstname', contact.firstName);
  set('lastname', contact.lastName);
  set('phone', contact.phone);
  set('city', contact.city);
  set('state', contact.state);
  set('zip', contact.postalCode);

  if (config.fieldMap) {
    const custom = (contact.customFields ?? {}) as Record<string, unknown>;
    for (const [loomiKey, hsProp] of Object.entries(config.fieldMap)) {
      set(hsProp, custom[loomiKey]);
    }
  }

  return props;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? text.slice(0, 300) : '(empty body)';
  } catch {
    return '(no body)';
  }
}

async function hubspotFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${HUBSPOT_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    // Network failure or timeout (abort) — always worth a retry.
    const msg = err instanceof Error ? err.message : 'network error';
    throw new HubspotError(`HubSpot request failed: ${msg}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a Private App token by hitting a lightweight, low-scope CRM
 * endpoint. Surfaces actionable messages for the two common setup mistakes
 * (wrong token, missing scope). Used by the "Test" button in the UI.
 */
export async function testHubspotConnection(token: string): Promise<{ ok: true }> {
  const res = await hubspotFetch(token, '/crm/v3/objects/contacts?limit=1', { method: 'GET' });
  if (res.ok) return { ok: true };

  const detail = await readErrorBody(res);
  const message =
    res.status === 401
      ? 'HubSpot rejected the token (401). Double-check the Private App access token.'
      : res.status === 403
        ? 'Token is missing CRM scope (403). Grant crm.objects.contacts.read + .write on the Private App.'
        : `HubSpot test failed (${res.status}): ${detail}`;
  throw new HubspotError(message, { retryable: isRetryableStatus(res.status), status: res.status });
}

/**
 * Pull the existing contact id out of a 409 "duplicate" create response.
 * HubSpot returns e.g. `{ message: "Contact already exists. Existing ID:
 * 12345", category: "CONFLICT" }`. We parse the JSON message first, then fall
 * back to scanning the raw body, so a phrasing tweak doesn't break us.
 */
export function parseExistingContactId(body: string): string | null {
  let text = body;
  try {
    const json = JSON.parse(body) as { message?: unknown };
    if (typeof json.message === 'string') text = json.message;
  } catch {
    // not JSON — scan the raw text
  }
  const m = text.match(/Existing ID:\s*(\d+)/i) ?? text.match(/\bID:?\s*(\d{3,})/i);
  return m ? m[1] : null;
}

/**
 * Create or update a contact, keyed on email. Idempotent — pushing the same
 * contact twice just refreshes it.
 *
 * We deliberately DON'T use the batch/upsert endpoint with `email` as the
 * idProperty: HubSpot's handling of email there is unreliable (documented 409s
 * / "non-unique" failures). Instead we POST a create, and on a 409 duplicate
 * we read the existing contact id from the error and PATCH it — the canonical,
 * dependable v3 "create-or-update by email". Returns the HubSpot contact id
 * (recorded as CrmDelivery.messageId for traceability).
 */
export async function upsertHubspotContact(args: {
  token: string;
  email: string;
  properties: Record<string, string>;
}): Promise<{ contactId: string }> {
  const email = args.email.trim();
  if (!email) {
    // No email → can't match a contact. Non-retryable: it won't grow one on a
    // retry. (Our funnel only pushes opted-in email contacts — this is a
    // guard, not an expected path.)
    throw new HubspotError('Contact has no email — cannot push to HubSpot.', {
      retryable: false,
    });
  }

  const properties = { ...args.properties, email };

  // 1) Try to create.
  const createRes = await hubspotFetch(args.token, '/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  if (createRes.ok) {
    const json = (await createRes.json().catch(() => null)) as { id?: string } | null;
    if (json?.id) return { contactId: json.id };
    throw new HubspotError('HubSpot create returned no contact id.', { retryable: true });
  }

  // 2) Already exists → update the existing record in place.
  if (createRes.status === 409) {
    const errBody = await createRes.text().catch(() => '');
    const existingId = parseExistingContactId(errBody);
    if (!existingId) {
      throw new HubspotError(
        `HubSpot reported a duplicate contact but no existing id could be parsed: ${errBody.slice(0, 200)}`,
        { retryable: false },
      );
    }
    const patchRes = await hubspotFetch(args.token, `/crm/v3/objects/contacts/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    if (patchRes.ok) return { contactId: existingId };
    const detail = await readErrorBody(patchRes);
    throw new HubspotError(`HubSpot contact update failed (${patchRes.status}): ${detail}`, {
      retryable: isRetryableStatus(patchRes.status),
      status: patchRes.status,
    });
  }

  // 3) Anything else is a real failure.
  const detail = await readErrorBody(createRes);
  throw new HubspotError(`HubSpot contact create failed (${createRes.status}): ${detail}`, {
    retryable: isRetryableStatus(createRes.status),
    status: createRes.status,
  });
}

/**
 * Create a deal in the configured pipeline/stage and associate it to the
 * contact, so the qualified lead lands as a workable opportunity for PJF's
 * reps. Best-effort relative to the contact upsert: deliver.ts treats a deal
 * failure as non-fatal (the contact is already in HubSpot).
 */
export async function createHubspotDeal(args: {
  token: string;
  contactId: string;
  dealName: string;
  pipelineId: string;
  stageId: string;
}): Promise<{ dealId: string }> {
  const body = {
    properties: {
      dealname: args.dealName,
      pipeline: args.pipelineId,
      dealstage: args.stageId,
    },
    associations: [
      {
        to: { id: args.contactId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID,
          },
        ],
      },
    ],
  };
  const res = await hubspotFetch(args.token, '/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new HubspotError(`HubSpot deal create failed (${res.status}): ${detail}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status,
    });
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!json?.id) {
    throw new HubspotError('HubSpot deal create returned no id.', { retryable: true });
  }
  return { dealId: json.id };
}
