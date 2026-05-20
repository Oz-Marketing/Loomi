import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { normalizeOems } from '@/lib/oems';
import * as accountService from '@/lib/services/accounts';
import '@/lib/esp/init';
import { getAdapterForAccount } from '@/lib/esp/registry';
import type { CustomValueInput, EspCredentials } from '@/lib/esp/types';
import { buildAccountConnectionMetadata } from '@/lib/esp/account-connection-metadata';
import { normalizeAccountInputAliases } from '@/lib/account-field-aliases';
import { normalizeAccountOutputPayload } from '@/lib/account-output';
import { listOAuthConnections } from '@/lib/esp/oauth-connections';
import { listApiKeyConnections } from '@/lib/esp/api-key-connections';
import { listAccountProviderLinks } from '@/lib/esp/account-provider-links';

async function resolveAccountConnectionMetadata(account: {
  key: string;
  espProvider?: string | null;
}) {
  const [oauthConnections, espConnections, accountProviderLinks] = await Promise.all([
    listOAuthConnections({ accountKeys: [account.key] }),
    listApiKeyConnections({ accountKeys: [account.key] }),
    listAccountProviderLinks({ accountKeys: [account.key] }).catch(() => []),
  ]);

  const mergedOauthConnections: Array<{
    provider: string;
    locationId: string | null;
    locationName: string | null;
    installedAt: Date;
  }> = oauthConnections.map((connection) => ({
    provider: connection.provider,
    locationId: connection.locationId,
    locationName: connection.locationName,
    installedAt: connection.installedAt,
  }));
  const oauthProviders = new Set(mergedOauthConnections.map((connection) => connection.provider));
  for (const link of accountProviderLinks) {
    if (oauthProviders.has(link.provider)) continue;
    mergedOauthConnections.push({
      provider: link.provider,
      locationId: link.locationId,
      locationName: link.locationName,
      installedAt: link.linkedAt,
    });
  }

  return buildAccountConnectionMetadata({
    accountProvider: account.espProvider,
    oauthConnections: mergedOauthConnections,
    espConnections,
  });
}

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
    const stringFields = ['dealer', 'category', 'oem', 'email', 'phone', 'salesPhone', 'servicePhone', 'partsPhone', 'address', 'city', 'state', 'postalCode', 'website', 'timezone', 'senderEmail', 'senderName', 'sendingDomain', 'replyToEmail'] as const;
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

    // Markup rate (nullable Float). Empty string / null / non-numeric
    // input clears the override so the Pacer falls back to the global
    // default. We accept either a number or a numeric string from the form.
    if ('markup' in body) {
      const raw = body.markup;
      if (raw === '' || raw === null || raw === undefined) {
        updatePayload.markup = null;
      } else {
        const parsed = typeof raw === 'number' ? raw : Number(raw);
        updatePayload.markup = Number.isFinite(parsed) ? parsed : null;
      }
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

    // previewValues replaces entirely if provided
    const saved = await accountService.updateAccount(key, updatePayload);

    // ── Provider sync: push business details/custom values when supported ──
    const normalizeComparable = (value: unknown) =>
      value === null || value === undefined ? '' : String(value).trim();
    const businessDetailsChanged =
      normalizeComparable(existing.dealer) !== normalizeComparable(saved.dealer) ||
      normalizeComparable(existing.email) !== normalizeComparable(saved.email) ||
      normalizeComparable(existing.phone) !== normalizeComparable(saved.phone) ||
      normalizeComparable(existing.address) !== normalizeComparable(saved.address) ||
      normalizeComparable(existing.city) !== normalizeComparable(saved.city) ||
      normalizeComparable(existing.state) !== normalizeComparable(saved.state) ||
      normalizeComparable(existing.postalCode) !== normalizeComparable(saved.postalCode) ||
      normalizeComparable(existing.website) !== normalizeComparable(saved.website) ||
      normalizeComparable(existing.timezone) !== normalizeComparable(saved.timezone);
    const deleteManaged = body._deleteManaged === true;
    const customValuesChanged =
      normalizeComparable(existing.customValues) !== normalizeComparable(saved.customValues);

    let syncWarning: string | undefined;
    let adapter: Awaited<ReturnType<typeof getAdapterForAccount>> | null = null;
    let resolvedCredentials: EspCredentials | null | undefined;
    try {
      adapter = await getAdapterForAccount(key);
    } catch {
      adapter = null;
    }

    const resolveAdapterCredentials = async (): Promise<EspCredentials | null> => {
      if (resolvedCredentials !== undefined) {
        return resolvedCredentials;
      }
      if (!adapter) {
        resolvedCredentials = null;
        return resolvedCredentials;
      }

      resolvedCredentials = adapter.resolveCredentials
        ? await adapter.resolveCredentials(key)
        : adapter.contacts
          ? await adapter.contacts.resolveCredentials(key)
          : null;
      return resolvedCredentials;
    };

    if (adapter?.accountDetailsSync && businessDetailsChanged) {
      const credentials = await resolveAdapterCredentials();
      const locationId = credentials?.locationId || '';

      if (!locationId) {
        const msg = `Business details sync skipped: no ${adapter.provider} location/account context`;
        syncWarning = syncWarning ? `${syncWarning} | ${msg}` : msg;
      } else {
        const result = await adapter.accountDetailsSync.syncBusinessDetails(key, locationId, {
          name: saved.dealer || undefined,
          email: saved.email || undefined,
          phone: saved.phone || undefined,
          address: saved.address || undefined,
          city: saved.city || undefined,
          state: saved.state || undefined,
          postalCode: saved.postalCode || undefined,
          website: saved.website || undefined,
          timezone: saved.timezone || undefined,
        });

        if (!result.synced && result.warning) {
          syncWarning = result.warning;
        }
      }
    }

    // ── Custom Values sync (provider-capability based) ──
    const customValues = saved.customValues
      ? (JSON.parse(saved.customValues) as Record<string, { name: string; value: string }>)
      : null;
    if ((customValuesChanged || deleteManaged) && customValues && adapter?.capabilities.customValues && adapter.customValues) {
      try {
        const credentials = await resolveAdapterCredentials();

        if (!credentials) {
          const msg = `Custom values sync skipped: no ${adapter.provider} credentials available`;
          syncWarning = syncWarning ? `${syncWarning} | ${msg}` : msg;
        } else {
          const desired: CustomValueInput[] = [];
          const managedNames: string[] = [];
          for (const [fieldKey, def] of Object.entries(customValues)) {
            managedNames.push(def.name);
            if (def.value) {
              desired.push({ fieldKey, name: def.name, value: def.value });
            }
          }

          const cvResult = await adapter.customValues.syncCustomValues(
            credentials.token,
            credentials.locationId,
            desired,
            deleteManaged ? managedNames : undefined,
          );
          if (cvResult.errors.length > 0) {
            const errorMsg = cvResult.errors.map(e => `${e.fieldKey}: ${e.error}`).join('; ');
            syncWarning = syncWarning
              ? `${syncWarning} | Custom values sync partial: ${errorMsg}`
              : `Custom values sync partial: ${errorMsg}`;
          }
        }
      } catch (err) {
        console.warn(`Custom values sync error for ${key}:`, err);
        const msg = err instanceof Error ? err.message : 'Custom values sync failed';
        syncWarning = syncWarning ? `${syncWarning} | ${msg}` : msg;
      }
    }

    const response: Record<string, unknown> = { ...saved };
    normalizeAccountOutputPayload(response);
    Object.assign(response, await resolveAccountConnectionMetadata(saved));
    if (syncWarning) {
      response._syncWarning = syncWarning;
    }

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
    Object.assign(response, await resolveAccountConnectionMetadata(account));

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
