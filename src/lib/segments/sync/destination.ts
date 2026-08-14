// What an ad platform has to be able to do for us to sync a segment to
// it.
//
// Defined now, with only a dry-run implementation behind it, so the
// Google Customer Match work is a single file that satisfies this
// interface rather than a refactor of the orchestration. Meta and
// StackAdapt reuse ~90% of the same shape — normalise, hash, batch,
// poll a job — and differ mainly in packaging.

import { googleAdsDestination } from './google-ads';
import type { HashedIdentifiers } from '../identity';

export interface DestinationContext {
  accountKey: string;
  /** Provider's own account id (e.g. Account.googleAdsCustomerId). */
  externalAccountId: string | null;
  /** Remote user-list id, null before the first run creates it. */
  externalId: string | null;
  /** Human-readable name to give the remote list. */
  audienceName: string;
  /** Parsed AudienceSync.config. */
  config: Record<string, unknown>;
}

export interface PushOperations {
  add: Array<{ contactId: string; identifiers: HashedIdentifiers }>;
  /** Identity keys to remove — the contact rows may be long gone, so
   *  removals travel as the hashed identity that was uploaded. */
  remove: Array<{ contactId: string; dedupeKey: string | null }>;
}

export interface PushResult {
  /** Set when the destination created the list on this call. */
  externalId?: string;
  /** Accepted by the platform. Not the same as matched — matching is
   *  asynchronous and usually reported later. */
  accepted: number;
  /** True when nothing was actually transmitted. */
  dryRun: boolean;
}

export interface RemoteStatus {
  /** Members the platform reports holding, after matching. */
  size: number | null;
  matchRate: number | null;
  /** Whether the list is large enough to actually serve ads. */
  servable: boolean | null;
  note?: string;
}

export interface AudienceDestination {
  key: string;
  label: string;
  /** Create or find the remote list, returning its id. */
  ensureRemoteList(ctx: DestinationContext): Promise<string>;
  push(ctx: DestinationContext, ops: PushOperations): Promise<PushResult>;
  status(ctx: DestinationContext): Promise<RemoteStatus>;
}

/**
 * The only destination wired today: computes and records the delta but
 * transmits nothing.
 *
 * This is shadow mode, and it's genuinely useful on its own — it proves
 * the resolve → gate → dedupe → diff pipeline against real dealer data,
 * and produces the real numbers (segment size, eligible, added, removed)
 * needed to judge whether an audience is worth pushing, all without a
 * single contact leaving the building. It also means the first real
 * upload is a change of adapter, not a change of pipeline.
 */
export const dryRunDestination: AudienceDestination = {
  key: 'dry_run',
  label: 'Dry run (no upload)',

  async ensureRemoteList(ctx: DestinationContext): Promise<string> {
    return ctx.externalId ?? `dryrun:${ctx.accountKey}:${ctx.audienceName}`;
  },

  async push(_ctx: DestinationContext, ops: PushOperations): Promise<PushResult> {
    return { accepted: ops.add.length, dryRun: true };
  },

  async status(): Promise<RemoteStatus> {
    return {
      size: null,
      matchRate: null,
      servable: null,
      note: 'Dry run — nothing was uploaded, so the platform reports nothing.',
    };
  },
};

const DESTINATIONS = new Map<string, AudienceDestination>([
  [dryRunDestination.key, dryRunDestination],
  [googleAdsDestination.key, googleAdsDestination],
]);

/**
 * Look up a destination adapter. Returns null for a provider we know
 * about but haven't implemented yet — the run records that as `skipped`
 * with a reason rather than failing, so a sync configured ahead of its
 * adapter is inert instead of noisy.
 */
export function getDestination(provider: string): AudienceDestination | null {
  return DESTINATIONS.get(provider) ?? null;
}

/** Providers a sync may be configured for, whether or not an adapter
 *  exists yet. */
export const KNOWN_PROVIDERS = [
  'dry_run',
  'google_ads',
  'meta',
  'stackadapt',
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
