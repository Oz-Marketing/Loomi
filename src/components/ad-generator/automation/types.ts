/**
 * Wire types for the automation report — shared by the panel and the
 * `useAutomation` hook, which the page header also reads for the on/off switch.
 */

export interface FeedStatus {
  id: string;
  name: string;
  url: string;
  storeCode: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  vehicleCount: number;
  newVehicleCount: number;
  ageHours: number | null;
  stale: boolean;
}

export type CycleState = 'none' | 'current' | 'partial' | 'expiring_unrenewed' | 'undated' | 'unwatched';

export interface WatchedVehicle {
  year: number;
  make: string;
  model: string;
  stock: number;
  liveOffers: number;
  endedOffers: number;
  cycleState: CycleState;
  cycleSummary: string;
  /** Distinct types among the live offers. */
  offerTypes: string[];
  latestEnd: string | null;
  wouldChoose: string | null;
  wouldChooseType: string | null;
  firstSeenAt: string | null;
}

export interface LeadTimeStat {
  make: string;
  median: number;
  min: number;
  max: number;
  n: number;
}

export interface RunSkip {
  vehicle: string;
  reason: string;
  detail: string;
}

export interface RunSummary {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  scopesChecked: number;
  offersSeen: number;
  offersNew: number;
  offersEnded: number;
  vehiclesSeen: number;
  issueCount: number;
  error: string | null;
  /** Why vehicles were passed over — the run's own record of it. */
  skipped: RunSkip[];
  generatedCount: number | null;
}

export interface ShadowScope {
  makes: string[];
  focusModels: string[];
  excludeModels: string[];
  zip: string | null;
  templateMap: Record<string, string>;
  /** Size ids to render; empty = every size the template defines. */
  sizeIds: string[];
  radius: number;
  maxAdsPerRun: number;
  minStock: number;
  offerTypePriority: string[];
  mode: string;
}

export interface GeneratedDraft {
  id: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  coopCheckedVersion: string | null;
  expiresAt: string | null;
  reviewNotes: string[];
  updatedAt: string;
}

export interface ShadowReport {
  accountKey: string;
  configured: boolean;
  enabled: boolean;
  scope: ShadowScope;
  templates: {
    id: string;
    name: string;
    owned: boolean;
    sizes: { id: string; label: string; width: number; height: number }[];
  }[];
  drafts: GeneratedDraft[];
  runWindow: { start: string; end: string; mode: string };
  feeds: FeedStatus[];
  vehicles: WatchedVehicle[];
  leadTimes: LeadTimeStat[];
  runs: RunSummary[];
  totals: {
    newUnits: number;
    stockGroups: number;
    groupsWithOffer: number;
    matchRatePct: number;
    liveOffers: number;
    awaitingNextCycle: number;
  };
}
