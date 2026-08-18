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
  /** Whether the run also drafts the companion offer email. */
  emailEnabled: boolean;
  /** `Template.slug` of the v2 shell; empty/null = compose from the brand kit. */
  emailTemplateId: string | null;
  /** `Audience` id the draft is pre-targeted at; null = no recipients. */
  emailAudienceId: string | null;
  emailMaxOffers: number;
  /** `Playbook.id` this sub-account follows, or null for a hand-picked setup. */
  playbookId: string | null;
  /** One ad per qualifying offer type, rather than only the best. */
  expandOfferTypes: boolean;
}

/** Which parts of a playbook a sub-account has diverged from. */
export type CreativeStep = 'adTemplate' | 'sizes' | 'emailTemplate' | 'emailMaxOffers';

export interface CreativeDefinition {
  adTemplateId: string;
  sizeIds: string[];
  emailTemplateSlug: string;
  emailMaxOffers: number;
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
  /**
   * The followed playbook, resolved. `detached` names the steps this
   * sub-account has diverged from — derived server-side by comparing the config
   * to the definition, so it is never stale.
   */
  playbook: {
    id: string;
    name: string;
    version: number;
    definition: CreativeDefinition;
    detached: CreativeStep[];
  } | null;
  /** Published playbooks, definitions included so the picker can preset. */
  playbookOptions: {
    id: string;
    name: string;
    scopeValue: string | null;
    version: number;
    definition: CreativeDefinition;
  }[];
  /** v2 email templates on this sub-account, as offer-email shell candidates. */
  emailTemplates: { slug: string; title: string; hasOffersBlock: boolean }[];
  /** Saved audiences, for pre-targeting the offer email draft. */
  audiences: { id: string; name: string }[];
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
    /** VINs on the lot → distinct trims → ads a run would produce. */
    vins: number;
    trimGroups: number;
    adsThisRun: number;
  };
}
