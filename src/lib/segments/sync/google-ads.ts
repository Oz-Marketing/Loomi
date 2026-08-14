// Google Ads Customer Match destination.
//
// Three API surfaces, in the order a sync uses them:
//
//   1. UserListService.mutate       — create the CRM-based list (once)
//   2. OfflineUserDataJobService    — create a job, add hashed
//      identifiers in batches, run it (every sync)
//   3. GoogleAdsService.search      — read back list size + match rate
//
// The upload is asynchronous by design: `run` returns immediately and
// Google matches in the background, typically over hours. So `push`
// reports what was ACCEPTED, and match numbers arrive later via
// `status()`. Conflating the two is the classic Customer Match mistake —
// "we uploaded 40,000" is not "we can target 40,000".
//
// Everything here is gated behind an explicit, activated AudienceSync
// row for the google_ads provider. Nothing uploads by accident.

import {
  getGoogleAdsConfig,
  GoogleAdsError,
  type GoogleAdsConfig,
} from '@/lib/integrations/google-ads';
import type { HashedIdentifiers } from '../identity';
import type {
  AudienceDestination,
  DestinationContext,
  PushOperations,
  PushResult,
  RemoteStatus,
} from './destination';

const ADS_BASE = 'https://googleads.googleapis.com';

// Google accepts large jobs but recommends keeping a single
// addOperations request modest; 5,000 operations per call stays well
// inside the request-size limit while keeping round-trips low. A 40k
// audience is 8 calls.
const OPERATIONS_PER_REQUEST = 5_000;

// Customer Match lists below roughly this many MATCHED members won't
// serve on most surfaces. The list still exists and still accepts
// uploads — it just silently targets nothing, which is why this is worth
// surfacing rather than discovering three weeks into a campaign.
export const MIN_SERVABLE_MEMBERS = 1_000;

// Google's maximum membership lifespan, in days. Also the sensible
// default for a dealer audience: shorter windows quietly drop people who
// are still valid prospects.
const DEFAULT_MEMBERSHIP_DAYS = 540;

function stripDashes(id: string): string {
  return id.replace(/-/g, '').trim();
}

async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new GoogleAdsError(
      `Google OAuth refresh failed: ${json.error_description ?? res.status}`,
      'api_error',
      res.status,
    );
  }
  return json.access_token;
}

async function adsPost(
  cfg: GoogleAdsConfig,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const token = await accessToken(cfg);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;

  let res: Response;
  try {
    res = await fetch(`${ADS_BASE}/${cfg.apiVersion}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GoogleAdsError(
      `Could not reach the Google Ads API: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    console.error(
      '[customer-match] request failed',
      path,
      res.status,
      JSON.stringify(json)?.slice(0, 1200),
    );
    throw new GoogleAdsError(
      `Google Ads (${path.split('/').pop()}): ${errorMessage(json, res.status)}`,
      'api_error',
      res.status,
    );
  }
  return json ?? {};
}

/** Pull the most useful line out of a Google Ads error envelope. */
function errorMessage(json: unknown, status: number): string {
  const envelope = json as
    | {
        error?: {
          message?: string;
          details?: Array<{ errors?: Array<{ message?: string; errorCode?: Record<string, string> }> }>;
        };
      }
    | null;
  const detail = envelope?.error?.details?.[0]?.errors?.[0];
  if (detail?.message) {
    const code = detail.errorCode ? Object.values(detail.errorCode)[0] : null;
    return code ? `${detail.message} (${code})` : detail.message;
  }
  return envelope?.error?.message ?? `HTTP ${status}`;
}

/** HashedIdentifiers → the UserIdentifier list Google expects. */
export function toUserIdentifiers(identifiers: HashedIdentifiers): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (identifiers.hashedEmail) out.push({ hashedEmail: identifiers.hashedEmail });
  if (identifiers.hashedPhone) out.push({ hashedPhoneNumber: identifiers.hashedPhone });
  if (identifiers.address) {
    // All four parts travel together — Google rejects partial address
    // info, and name-only matching isn't a thing.
    out.push({
      addressInfo: {
        hashedFirstName: identifiers.address.hashedFirstName,
        hashedLastName: identifiers.address.hashedLastName,
        postalCode: identifiers.address.postalCode,
        countryCode: identifiers.address.countryCode,
      },
    });
  }
  return out;
}

/** Rebuild a removal identifier from the stored dedupe key. Removals
 *  travel as the hash that was uploaded, since the contact row may be
 *  gone by now. */
export function dedupeKeyToIdentifier(key: string | null): Record<string, unknown> | null {
  if (!key) return null;
  if (key.startsWith('e:')) return { hashedEmail: key.slice(2) };
  if (key.startsWith('p:')) return { hashedPhoneNumber: key.slice(2) };
  return null;
}

function requireConfig(): GoogleAdsConfig {
  const cfg = getGoogleAdsConfig();
  if (!cfg) {
    throw new GoogleAdsError(
      'Google Ads credentials are not configured in this environment',
      'not_configured',
    );
  }
  return cfg;
}

function requireCustomerId(ctx: DestinationContext): string {
  if (!ctx.externalAccountId) {
    throw new GoogleAdsError(
      `No Google Ads customer id on account ${ctx.accountKey} — set it before syncing`,
      'no_customer',
    );
  }
  return stripDashes(ctx.externalAccountId);
}

export const googleAdsDestination: AudienceDestination = {
  key: 'google_ads',
  label: 'Google Ads (Customer Match)',

  async ensureRemoteList(ctx: DestinationContext): Promise<string> {
    if (ctx.externalId) return ctx.externalId;

    const cfg = requireConfig();
    const customerId = requireCustomerId(ctx);
    const membershipDays =
      typeof ctx.config.membershipDays === 'number'
        ? ctx.config.membershipDays
        : DEFAULT_MEMBERSHIP_DAYS;

    const response = await adsPost(cfg, `customers/${customerId}/userLists:mutate`, {
      operations: [
        {
          create: {
            name: `Loomi — ${ctx.audienceName}`,
            description: `Synced from the Loomi segment "${ctx.audienceName}".`,
            membershipLifeSpan: String(membershipDays),
            crmBasedUserList: {
              // Matching on the contact details we hold, rather than on
              // ad ids or user-provided ids from a site tag.
              uploadKeyType: 'CONTACT_INFO',
              // First-party data collected by the dealer. This is the
              // declaration the Customer Match policy is enforced
              // against, so it must be accurate — see the consent basis
              // recorded per sub-account.
              dataSourceType: 'FIRST_PARTY',
            },
          },
        },
      ],
    });

    const results = response.results as Array<{ resourceName?: string }> | undefined;
    const resourceName = results?.[0]?.resourceName;
    if (!resourceName) {
      throw new GoogleAdsError(
        'Google Ads accepted the user-list creation but returned no resource name',
        'api_error',
      );
    }
    return resourceName;
  },

  async push(ctx: DestinationContext, ops: PushOperations): Promise<PushResult> {
    const cfg = requireConfig();
    const customerId = requireCustomerId(ctx);
    const userList = ctx.externalId;
    if (!userList) {
      throw new GoogleAdsError(
        'ensureRemoteList must run before push — no user list resource name',
        'api_error',
      );
    }

    // Consent travels with the job. GRANTED asserts the dealer collected
    // this data with disclosure permitting third-party ad use, which is
    // exactly what the per-sub-account consent basis records; the
    // eligibility gate refuses to resolve a sync at all unless one is on
    // file, so reaching here means it was affirmed.
    const consent = {
      adUserData: 'GRANTED',
      adPersonalization: 'GRANTED',
    };

    const created = await adsPost(cfg, `customers/${customerId}/offlineUserDataJobs:create`, {
      job: {
        type: 'CUSTOMER_MATCH_USER_LIST',
        customerMatchUserListMetadata: { userList, consent },
      },
    });
    const jobResourceName = created.resourceName as string | undefined;
    if (!jobResourceName) {
      throw new GoogleAdsError(
        'Google Ads created no offline user data job',
        'api_error',
      );
    }

    // Build the operation list: creates for additions, removes for
    // departures.
    const operations: Array<Record<string, unknown>> = [];
    for (const entry of ops.add) {
      const userIdentifiers = toUserIdentifiers(entry.identifiers);
      if (userIdentifiers.length === 0) continue;
      operations.push({ create: { userIdentifiers } });
    }
    for (const entry of ops.remove) {
      const identifier = dedupeKeyToIdentifier(entry.dedupeKey);
      if (!identifier) continue;
      operations.push({ remove: { userIdentifiers: [identifier] } });
    }

    let accepted = 0;
    for (let i = 0; i < operations.length; i += OPERATIONS_PER_REQUEST) {
      const batch = operations.slice(i, i + OPERATIONS_PER_REQUEST);
      // Partial failure so one malformed identifier can't reject an
      // entire batch of legitimate ones. Rejections come back per
      // operation and are logged rather than thrown — the sync's job is
      // to move as much valid data as it can and report the rest.
      const response = await adsPost(cfg, `${jobResourceName}:addOperations`, {
        enablePartialFailure: true,
        operations: batch,
      });
      const partial = response.partialFailureError as { message?: string } | undefined;
      if (partial?.message) {
        console.warn(
          '[customer-match] partial failure on batch',
          i / OPERATIONS_PER_REQUEST,
          partial.message.slice(0, 500),
        );
      }
      accepted += batch.length;
    }

    // Kick the job off. This returns as soon as it's queued; matching
    // happens asynchronously on Google's side.
    await adsPost(cfg, `${jobResourceName}:run`, {});

    return { externalId: userList, accepted, dryRun: false };
  },

  async status(ctx: DestinationContext): Promise<RemoteStatus> {
    const cfg = requireConfig();
    const customerId = requireCustomerId(ctx);
    if (!ctx.externalId) return { size: null, matchRate: null, servable: null };

    const listId = ctx.externalId.split('/').pop();
    const rows = await adsPost(cfg, `customers/${customerId}/googleAds:search`, {
      query: `
        SELECT user_list.id,
               user_list.name,
               user_list.size_for_display,
               user_list.size_for_search,
               user_list.membership_status
        FROM user_list
        WHERE user_list.id = ${Number(listId)}
      `,
    });

    const results = rows.results as
      | Array<{ userList?: { sizeForDisplay?: string; sizeForSearch?: string } }>
      | undefined;
    const list = results?.[0]?.userList;
    if (!list) return { size: null, matchRate: null, servable: null };

    // Display and Search report different matched sizes (the surfaces
    // have different matching rules). The larger is the more useful
    // headline; the servability check uses it too.
    const display = Number(list.sizeForDisplay ?? 0);
    const search = Number(list.sizeForSearch ?? 0);
    const size = Math.max(display, search);

    return {
      size,
      // Match rate needs the uploaded total as its denominator, which
      // the caller holds (AudienceSyncRun.total) — not something the
      // platform reports back.
      matchRate: null,
      servable: size >= MIN_SERVABLE_MEMBERS,
      note:
        size < MIN_SERVABLE_MEMBERS
          ? `Only ${size.toLocaleString()} matched members — Customer Match generally needs ~${MIN_SERVABLE_MEMBERS.toLocaleString()} before it will serve.`
          : undefined,
    };
  },
};
