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
  budgetSource: 'base' | 'added';
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
