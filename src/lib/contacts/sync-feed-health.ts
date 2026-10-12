/**
 * The reporting feeds — calls, reviews, mailer — checked PER FEED, not per
 * account, and deliberately so. Used by GET /api/internal/contact-sync/health.
 *
 * The CRM feeds are per-account because every mapped rooftop should be
 * producing contacts and events; silence from one is a real signal. These
 * three are not: calls exist only for a dealer with a `call_tracker_id`,
 * reviews only for a rooftop with a Google `place_id`, and mailer campaigns
 * only for an account that has actually mailed. Flagging every account that
 * legitimately has none would mean dozens of daily false alarms — which is
 * how a monitor gets muted and stops being a monitor.
 *
 * What CAN be checked without noise is the feed itself: these are driven by
 * one cron on the Oz Reports host, so "has this feed reported from anywhere
 * recently" answers the question.
 *
 * Severities:
 * - `never-run` fails — the feed is supposed to exist and has never arrived.
 * - `stale` fails where `staleIsFailure`, warns otherwise (mailer is episodic).
 * - `awaiting-producer` warns — see `awaitingProducer` below.
 */

export type FeedStatus = 'ok' | 'stale' | 'never-run' | 'awaiting-producer';

export interface ReportingFeedDef {
  kind: string;
  label: string;
  staleIsFailure: boolean;
  note: string;
  /**
   * Set while the Oz Reports endpoint that SENDS this feed has not been
   * written or deployed. The Loomi ingest exists and the nightly script calls
   * the endpoint, but the endpoint 404s on the host, so no batch can arrive.
   *
   * Why this exists: on 2026-09-16 we found `pushcalls`, `pushreviews` and
   * `pushmailer` were never built in Oz Reports. Failing on them every day
   * turned the whole job permanently red, so a real contact outage would land
   * in a run that had already failed 30+ times — the monitor was muted by its
   * own noise.
   *
   * It only softens `never-run`. The moment the feed delivers a batch it is
   * judged like any other feed, so shipping the producer arms the check with
   * no change here. Still, delete the field when the producer ships.
   */
  awaitingProducer?: string;
}

export const REPORTING_FEEDS: ReportingFeedDef[] = [
  {
    kind: 'calls',
    label: 'Call Tracking',
    staleIsFailure: true,
    note: 'Every dealer with a call tracker produces calls daily.',
    awaitingProducer:
      'Oz Reports `pushcalls` is written in the local copy but not yet uploaded to the host.',
  },
  {
    kind: 'reviews',
    label: 'Reputation history',
    staleIsFailure: true,
    note: 'Runs on a 90-day window across every rooftop, so it is effectively never empty.',
    awaitingProducer:
      'Oz Reports `pushreviews` is not built — the ozrep database exposes only review aggregates, not individual reviews.',
  },
  {
    kind: 'mailer',
    label: 'Direct Mail ROI',
    // Warning, not failure. Mail drops are episodic — a group can genuinely
    // go weeks without one, and the bridge skips the POST when a dealer has
    // nothing in the window. Failing on that would cry wolf.
    staleIsFailure: false,
    note: 'Campaigns are episodic; a quiet stretch is normal. Never-run is still a failure.',
    awaitingProducer:
      'Oz Reports `pushmailer` is not built — it needs the purls matchback from Loaders::roisummarypurl.',
  },
];

export function feedStatus(
  def: ReportingFeedDef,
  hoursSinceLastRun: number | null,
  maxAgeHours: number,
): { status: FeedStatus; failing: boolean } {
  if (hoursSinceLastRun === null) {
    return def.awaitingProducer
      ? { status: 'awaiting-producer', failing: false }
      : { status: 'never-run', failing: true };
  }
  if (hoursSinceLastRun > maxAgeHours) {
    return { status: 'stale', failing: def.staleIsFailure };
  }
  return { status: 'ok', failing: false };
}
