/**
 * Shared types for the Meta Ad Planner / Ad Pacer pages. Pure data — no
 * React, no DOM. Server routes use parallel `IncomingAd` shapes; this file
 * is the client-side source of truth.
 */

export interface DirectoryUser {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  accountKeys?: string[];
}

export interface DesignNote {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
}

export interface ActivityEntry {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
  attachmentKey: string | null;
  attachmentFilename: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  attachmentUrl: string | null;
}

export interface PacerAd {
  id: string;
  position: number;
  name: string;
  period: string;
  ownerUserId: string | null;
  designerUserId: string | null;
  accountRepUserId: string | null;
  actionNeeded: string | null;
  recurring: string;
  coop: string;
  budgetType: 'Daily' | 'Lifetime';
  // "split" = allocation is divided between Base and Added pools.
  // `splitBaseAmount` records how much of `allocation` is from Base; the
  // remainder is from Added. pacerActual apportions proportionally.
  budgetSource: 'base' | 'added' | 'split';
  splitBaseAmount: string | null;
  flightStart: string | null;
  flightEnd: string | null;
  liveDate: string | null;
  creativeDueDate: string | null;
  dueDate: string | null;
  dateCompleted: string | null;
  adStatus: string;
  designStatus: string;
  internalApproval: string;
  clientApproval: string;
  allocation: string | null;
  pacerActual: string | null;
  pacerDailyBudget: string | null;
  pacerTodayDate: string | null;
  pacerEndDate: string | null;
  creativeLink: string | null;
  clientName: string | null;
  digitalDetails: string | null;
  // Facebook (Meta) sync. Server-managed: set by the Sync-from-Facebook job,
  // never edited in the form. `metaObjectId` set = row is linked and its
  // spend is owned by Facebook; `pacerSyncedAt` is an ISO timestamp.
  metaObjectType: string | null;
  metaObjectId: string | null;
  metaEffectiveStatus: string | null;
  pacerSyncedAt: string | null;
  // Actual run schedule from Meta (account-TZ YYYY-MM-DD). Server-managed;
  // the pacer clamps these to the pacing month. metaEndDate null = open-ended.
  metaStartDate: string | null;
  metaEndDate: string | null;
  // Per-ad alert mute (Change 9): silences pacing-family alerts for this ad.
  alertsMuted: boolean;
  designNotes: DesignNote[];
  activityLog: ActivityEntry[];
}

export interface PacerPlan {
  accountKey: string;
  period: string;
  baseBudgetGoal: string | null;
  addedBudgetGoal: string | null;
  // Per-account markup override (Account.markup). `null` → use the
  // platform default (MARKUP constant in the calculator). Drives the
  // gross↔actual conversion in the Budget Calculator's Client Budget mode.
  markup: number | null;
  ads: PacerAd[];
}

export interface PeriodSummary {
  period: string;
  adCount: number;
}

export type PacingStatus = 'on-track' | 'overpacing' | 'underpacing' | 'no-data';

export type PacerInnerTab = 'pacer' | 'summary' | 'compare';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
