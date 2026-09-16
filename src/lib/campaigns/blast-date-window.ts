/**
 * Date-range filtering for the Blasts list.
 *
 * The range picker is a window over HISTORY — "what went out in the last 6
 * months". A blast that has NOT gone out yet is dated by when it *will* send,
 * and every preset in `getDateRangeBounds` ends at `now`, so running a future
 * date through the same upper bound hides it on every preset. That is how a
 * blast scheduled for tomorrow morning became invisible the moment it was
 * scheduled: the list had fetched it, then filtered it straight back out.
 *
 * Only "All time" escaped, and only by accident — its `start` is null, which
 * skipped the filter wholesale rather than by intent.
 *
 * So: upcoming sends are always in the window. The range narrows history.
 */

/** The date fields the list rows carry. Structural on purpose. */
export interface BlastDates {
  sentAt?: string;
  scheduledAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

/**
 * The single date a row is filtered and sorted by: when it sent, else when it
 * is due to send, else when it was last touched.
 */
export function getCampaignDate(campaign: BlastDates): Date | null {
  const raw =
    campaign.sentAt ||
    campaign.scheduledAt ||
    campaign.updatedAt ||
    campaign.createdAt;

  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Nothing has sent yet and its send date is still ahead of us. */
export function isUpcoming(campaign: BlastDates, now: Date = new Date()): boolean {
  if (campaign.sentAt) return false;
  const date = getCampaignDate(campaign);
  return date !== null && date.getTime() > now.getTime();
}

/** Plain containment, both bounds inclusive. */
export function inRange(campaign: BlastDates, start: Date, end: Date): boolean {
  const date = getCampaignDate(campaign);
  if (!date) return false;
  const value = date.getTime();
  return value >= start.getTime() && value <= end.getTime();
}

/**
 * Should this row survive the current date range? A null `start` means "all
 * time" and filters nothing. Upcoming sends always survive.
 */
export function withinDateWindow(
  campaign: BlastDates,
  start: Date | null,
  end: Date,
  now: Date = new Date(),
): boolean {
  if (!start) return true;
  if (isUpcoming(campaign, now)) return true;
  return inRange(campaign, start, end);
}
