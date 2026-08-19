// TCPA quiet-hours evaluation for SMS blasts.
//
// WHY THIS EXISTS
// ───────────────
// Nothing in the blast pipeline previously looked at the clock. The TCPA
// restricts marketing calls and texts to 8:00am–9:00pm in the CALLED PARTY's
// local time, and statutory damages run $500–$1,500 per message. At the
// 5,000-recipient cap per blast, a single send at the wrong hour is six-figure
// exposure — which makes this the one check in the SMS pipeline whose absence
// could cost more than every other defect combined.
//
// The window is evaluated per recipient, from the phone's area code (see
// phone-timezone.ts), because one instant is 8am in one zone and 5am in
// another. Recipients outside their window are HELD, not failed: the blast
// stays in flight and each tranche goes out as its own local window opens.
// That is what makes "schedule it and let it land at 8am" work for a list
// spanning four timezones.

import { timezonesForPhone } from '@/lib/sending/phone-timezone';

/** Earliest permitted local hour, inclusive. 8:00am. */
export const QUIET_HOURS_START_HOUR = 8;
/** Latest permitted local hour, exclusive. 21:00 = messages until 8:59:59pm. */
export const QUIET_HOURS_END_HOUR = 21;

/**
 * Give up holding a recipient after this long and fail them instead.
 *
 * Without a cap, a recipient whose zone never resolves — or a blast left
 * queued across a DST oddity — would sit pending forever while the sweep
 * re-picked the blast every minute. 48h comfortably covers "queued at 10pm,
 * sent at 8am" plus any timezone spread, and anything beyond that is a stale
 * offer nobody should be texting about anyway.
 */
export const MAX_DEFERRAL_MS = 48 * 60 * 60 * 1000;

/**
 * Local wall-clock hour for an instant in a given IANA zone.
 *
 * Uses Intl rather than manual offset arithmetic so DST transitions are
 * handled by the platform's tz database. An invalid zone throws from
 * DateTimeFormat, which callers treat as "unknown zone".
 */
function localHourIn(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(instant);
  // hour12:false yields "00".."23", but some ICU builds emit "24" at midnight.
  const hour = Number(formatted);
  if (!Number.isFinite(hour)) return NaN;
  return hour === 24 ? 0 : hour;
}

/** Is `instant` inside the permitted window in this one zone? */
function isPermittedIn(instant: Date, timeZone: string): boolean {
  const hour = localHourIn(instant, timeZone);
  if (Number.isNaN(hour)) return false;
  return hour >= QUIET_HOURS_START_HOUR && hour < QUIET_HOURS_END_HOUR;
}

export interface ResolveZonesInput {
  phone: string | null | undefined;
  /** The sending rooftop's IANA timezone, used when the area code is unknown. */
  accountTimezone?: string | null;
}

export interface ResolvedZones {
  zones: string[];
  /** How the zones were determined — surfaced in UI copy and logs. */
  source: 'area-code' | 'account' | 'none';
}

/** Does this string name a zone the runtime actually knows? */
export function isValidTimeZone(zone: string | null | undefined): boolean {
  const value = String(zone || '').trim();
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Timezones to evaluate a recipient against.
 *
 * Falls back to the sending account's timezone rather than to a default like
 * Eastern: a guess that happens to be three zones off is worse than admitting
 * we don't know, and the rooftop's own zone is right for the overwhelming
 * majority of a dealership's list.
 */
export function resolveRecipientZones(input: ResolveZonesInput): ResolvedZones {
  const fromAreaCode = timezonesForPhone(input.phone);
  if (fromAreaCode.length > 0) {
    return { zones: fromAreaCode, source: 'area-code' };
  }
  if (isValidTimeZone(input.accountTimezone)) {
    return { zones: [String(input.accountTimezone)], source: 'account' };
  }
  return { zones: [], source: 'none' };
}

/**
 * May we text this recipient at `instant`?
 *
 * With several candidate zones (an area code straddling a boundary) EVERY zone
 * must permit it. With no zone at all we return true: we cannot prove a
 * violation, and blocking every unrecognized number would make the feature
 * unusable for legitimate international or newly-allocated numbers. Preflight
 * reports the unknown-zone count separately so the decision stays visible.
 */
export function isWithinQuietHours(
  instant: Date,
  zones: string[],
): boolean {
  if (zones.length === 0) return true;
  return zones.every((zone) => isPermittedIn(instant, zone));
}

/**
 * The next instant at or after `from` when every zone permits a send.
 *
 * Steps forward in 15-minute increments over a 3-day horizon. Coarse stepping
 * is deliberate: the window boundary is on the hour, we only need to land
 * inside it, and this avoids reimplementing zoned date arithmetic (and its DST
 * edge cases) by hand. Returns null when no slot exists inside the horizon,
 * which in practice means the candidate zones don't overlap at all.
 */
export function nextPermittedInstant(
  from: Date,
  zones: string[],
): Date | null {
  if (zones.length === 0) return from;
  if (isWithinQuietHours(from, zones)) return from;

  const STEP_MS = 15 * 60 * 1000;
  const HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

  // Start from the next quarter-hour boundary so the returned time reads as a
  // clean "8:00am" rather than "8:03:47am".
  let cursor = Math.ceil((from.getTime() + 1) / STEP_MS) * STEP_MS;
  const limit = from.getTime() + HORIZON_MS;

  while (cursor <= limit) {
    const candidate = new Date(cursor);
    if (isWithinQuietHours(candidate, zones)) return candidate;
    cursor += STEP_MS;
  }
  return null;
}

export interface QuietHoursAssessment {
  /** Recipients that may be texted at the assessed instant. */
  permitted: number;
  /** Recipients inside a quiet period — these would be held, not sent. */
  held: number;
  /** Recipients whose zone could not be determined at all. */
  unknownZone: number;
  /** Recipients whose area code spans more than one zone. */
  ambiguousZone: number;
  /** Earliest instant at which a currently-held recipient could go out. */
  earliestResume: Date | null;
  /** Distinct zones represented, for UI copy. */
  zonesRepresented: string[];
}

export interface AssessRecipient {
  phone: string | null | undefined;
}

/**
 * Assess a whole recipient list against one send instant.
 *
 * Drives both the preflight report ("2,300 of 5,000 are in a quiet period")
 * and the Schedule step's deferral offer.
 */
export function assessQuietHours(
  recipients: AssessRecipient[],
  instant: Date,
  accountTimezone?: string | null,
): QuietHoursAssessment {
  let permitted = 0;
  let held = 0;
  let unknownZone = 0;
  let ambiguousZone = 0;
  let earliestResume: Date | null = null;
  const zonesRepresented = new Set<string>();

  for (const recipient of recipients) {
    const { zones, source } = resolveRecipientZones({
      phone: recipient.phone,
      accountTimezone,
    });

    if (source === 'none') unknownZone += 1;
    if (source === 'area-code' && zones.length > 1) ambiguousZone += 1;
    for (const zone of zones) zonesRepresented.add(zone);

    if (isWithinQuietHours(instant, zones)) {
      permitted += 1;
      continue;
    }

    held += 1;
    const resume = nextPermittedInstant(instant, zones);
    if (resume && (!earliestResume || resume < earliestResume)) {
      earliestResume = resume;
    }
  }

  return {
    permitted,
    held,
    unknownZone,
    ambiguousZone,
    earliestResume,
    zonesRepresented: [...zonesRepresented].sort(),
  };
}

/** Short human label for a zone, e.g. "America/Los_Angeles" → "Los Angeles". */
export function zoneLabel(zone: string): string {
  const tail = zone.split('/').pop() || zone;
  return tail.replace(/_/g, ' ');
}
