import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { normalizeOems } from '@/lib/oems';
import * as accountService from '@/lib/services/accounts';
import { normalizeAccountInputAliases } from '@/lib/account-field-aliases';
import { normalizeAccountOutputPayload } from '@/lib/account-output';
import { encryptToken } from '@/lib/crypto/encryption';

/**
 * Strip the ESP-era legacy column from an outbound account payload.
 * The DB column survives until a later phase but should never reach
 * the wire.
 */
function stripLegacyEspFields(payload: Record<string, unknown>): void {
  delete payload.espProvider;
}

/**
 * Never return the GoHighLevel Private Integration token (it's encrypted at
 * rest); surface only whether one is configured so the UI can show state.
 */
function maskGhlToken(payload: Record<string, unknown>): void {
  payload.ghlConfigured = Boolean(payload.ghlApiKey);
  delete payload.ghlApiKey;
}

/** Per-account reporting margins — nullable Float (%); empty/non-numeric clears. */
const NULLABLE_FLOAT_FIELDS = ['markup', 'facebookAdsMargin', 'stackadaptMargin', 'googleAdsMargin'] as const;

/**
 * PATCH /api/accounts/[key] — merge-update a single account
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { key } = await params;

    // Admin can only edit assigned accounts
    if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const existing = await accountService.getAccount(key);

    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const body = await req.json() as Record<string, unknown>;
    normalizeAccountInputAliases(body);

    // Normalize brand fields
    if (body && ('oems' in body || 'oem' in body)) {
      const normalizedOems = normalizeOems(body.oems, body.oem);
      body.oems = normalizedOems.length > 0 ? normalizedOems : undefined;
      body.oem = normalizedOems.length > 0 ? normalizedOems[0] : undefined;
    }

    // Build update payload, converting objects to JSON strings for DB storage
    const updatePayload: Record<string, string | number | null | undefined> = {};

    // Simple string fields
    const stringFields = ['dealer', 'category', 'oem', 'email', 'phone', 'salesPhone', 'servicePhone', 'partsPhone', 'address', 'city', 'state', 'postalCode', 'website', 'timezone', 'senderEmail', 'senderName', 'sendingDomain', 'replyToEmail', 'metaAdAccountId', 'stackadaptAdvertiserId', 'googleAdsCustomerId', 'ghlLocationId'] as const;
    for (const field of stringFields) {
      if (field in body) {
        const value = body[field];
        updatePayload[field] = value === undefined || value === null ? '' : String(value);
      }
    }

    // Account rep (nullable foreign key — not a simple string field)
    if ('accountRepId' in body) {
      updatePayload.accountRepId = body.accountRepId
        ? String(body.accountRepId)
        : null;
    }

    // Nullable Float fields (Pacer markup + the reporting margins). Empty /
    // null / non-numeric input clears the override. Number or numeric string.
    for (const field of NULLABLE_FLOAT_FIELDS) {
      if (field in body) {
        const raw = body[field];
        if (raw === '' || raw === null || raw === undefined) {
          updatePayload[field] = null;
        } else {
          const parsed = typeof raw === 'number' ? raw : Number(raw);
          updatePayload[field] = Number.isFinite(parsed) ? parsed : null;
        }
      }
    }

    // GoHighLevel Private Integration token — encrypted at rest. A non-empty
    // value is (re)encrypted; an explicit empty clears the connection. Only
    // sent by the form when the operator actually enters/changes it.
    if ('ghlApiKey' in body) {
      const raw = typeof body.ghlApiKey === 'string' ? body.ghlApiKey.trim() : '';
      updatePayload.ghlApiKey = raw ? encryptToken(raw) : '';
    }

    // JSON-serialized fields — deep merge with existing
    if (body.logos && typeof body.logos === 'object') {
      const existingLogos = existing.logos ? JSON.parse(existing.logos) : {};
      updatePayload.logos = JSON.stringify({ ...existingLogos, ...body.logos });
    } else if ('logos' in body) {
      updatePayload.logos =
        body.logos === undefined || body.logos === null
          ? ''
          : typeof body.logos === 'string'
            ? body.logos
            : JSON.stringify(body.logos);
    }

    if (body.branding && typeof body.branding === 'object') {
      const existingBranding = existing.branding ? JSON.parse(existing.branding) : {};
      updatePayload.branding = JSON.stringify({ ...existingBranding, ...body.branding });
    } else if ('branding' in body) {
      updatePayload.branding =
        body.branding === undefined || body.branding === null
          ? ''
          : typeof body.branding === 'string'
            ? body.branding
            : JSON.stringify(body.branding);
    }

    if ('oems' in body) {
      updatePayload.oems = body.oems ? JSON.stringify(body.oems) : '';
    }

    if ('customValues' in body) {
      updatePayload.customValues =
        body.customValues === undefined || body.customValues === null
          ? ''
          : typeof body.customValues === 'string'
            ? body.customValues
            : JSON.stringify(body.customValues);
    }

    // Persist locally only. Remote ESP sync was removed in the teardown.
    const saved = await accountService.updateAccount(key, updatePayload);

    const response: Record<string, unknown> = { ...saved };
    normalizeAccountOutputPayload(response);
    stripLegacyEspFields(response);
    maskGhlToken(response);

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/accounts/[key] — fetch a single account
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { key } = await params;

    // Admin can only view assigned accounts
    if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const account = await accountService.getAccount(key);

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const response: Record<string, unknown> = { ...account };
    normalizeAccountOutputPayload(response);
    stripLegacyEspFields(response);
    maskGhlToken(response);

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
