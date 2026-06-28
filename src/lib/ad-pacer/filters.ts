/**
 * Filter state + reducer for the planner. Quick-views (Mine / Overdue / etc.)
 * compose with the typed dropdowns (status, source, ad type, etc.) — every
 * predicate has to pass for an ad to remain visible.
 */

import { ACTIVE_STATUSES } from './constants';
import type { PacerAd } from './types';

export interface PlanFilters {
  status: string | null; // adStatus value | null
  source: 'all' | 'base' | 'added';
  adType: 'all' | 'Daily' | 'Lifetime';
  assigneeUserId: string | null;
  accountRepUserId: string | null;
  showMine: boolean;
  showOverdue: boolean;
  showNeedsApproval: boolean;
  showActive: boolean;
}

export const EMPTY_FILTERS: PlanFilters = {
  status: null,
  source: 'all',
  adType: 'all',
  assigneeUserId: null,
  accountRepUserId: null,
  showMine: false,
  showOverdue: false,
  showNeedsApproval: false,
  showActive: false,
};

export function filtersAreEmpty(f: PlanFilters): boolean {
  return (
    !f.status &&
    f.source === 'all' &&
    f.adType === 'all' &&
    !f.assigneeUserId &&
    !f.accountRepUserId &&
    !f.showMine &&
    !f.showOverdue &&
    !f.showNeedsApproval &&
    !f.showActive
  );
}

export function isAdOverdue(ad: PacerAd): boolean {
  if (!ad.creativeDueDate || ad.designStatus === 'Approved') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(ad.creativeDueDate + 'T00:00:00') < today;
}

export function applyFilters(
  ads: PacerAd[],
  filters: PlanFilters,
  currentUserId: string | null,
): PacerAd[] {
  if (filtersAreEmpty(filters)) return ads;
  return ads.filter((ad) => {
    if (filters.status && ad.adStatus !== filters.status) return false;
    if (filters.source !== 'all' && ad.budgetSource !== filters.source) return false;
    if (filters.adType !== 'all' && ad.budgetType !== filters.adType) return false;
    if (
      filters.accountRepUserId &&
      ad.accountRepUserId !== filters.accountRepUserId
    ) {
      return false;
    }
    if (filters.assigneeUserId) {
      const id = filters.assigneeUserId;
      if (
        ad.ownerUserId !== id &&
        ad.designerUserId !== id &&
        ad.accountRepUserId !== id
      ) {
        return false;
      }
    }
    if (filters.showMine && currentUserId) {
      if (
        ad.ownerUserId !== currentUserId &&
        ad.designerUserId !== currentUserId &&
        ad.accountRepUserId !== currentUserId
      ) {
        return false;
      }
    }
    if (filters.showOverdue && !isAdOverdue(ad)) return false;
    if (
      filters.showNeedsApproval &&
      ad.internalApproval !== 'Pending Approval' &&
      ad.clientApproval !== 'Pending Approval'
    ) {
      return false;
    }
    if (filters.showActive && !ACTIVE_STATUSES.includes(ad.adStatus)) return false;
    return true;
  });
}

export function activeFilterCount(f: PlanFilters): number {
  let n = 0;
  if (f.status) n++;
  if (f.source !== 'all') n++;
  if (f.adType !== 'all') n++;
  if (f.assigneeUserId) n++;
  if (f.accountRepUserId) n++;
  if (f.showMine) n++;
  if (f.showOverdue) n++;
  if (f.showNeedsApproval) n++;
  if (f.showActive) n++;
  return n;
}
