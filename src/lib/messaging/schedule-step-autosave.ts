'use client';

// Autosave for the blast builder's Schedule step.
//
// WHY THIS EXISTS
// ───────────────
// Recipients and Message save as you go; Schedule didn't. "When should this
// send?" lived only in component state, and UTM + follow-up were written only
// by the final Schedule click — so stepping back to Recipients or Message and
// returning reset all of it to defaults. Every setting on the step now lands
// in the draft's `metadata` JSON shortly after it changes, and the page
// restores from there on load.
//
// The send time is stored as an ABSOLUTE instant (ISO 8601, UTC) under
// `metadata.schedule.at`, never in `scheduledFor`: that column is what the
// schedule endpoint stamps on a committed send, and a draft must not look
// scheduled just because someone picked a time. It used to be stored as the
// pickers' zoneless wall clock (`YYYY-MM-DDTHH:mm`), which meant "9:00" to
// whichever browser read it back — a colleague in another zone reopening the
// draft silently moved the send by the difference. Old values are still read.
//
// Settings go up as a `metadataPatch` the server merges into the stored blob,
// so this step can't overwrite keys other steps own, whatever it last loaded.

import { useDraftAutosave, patchJson, type DraftAutosave } from './builder-autosave';
import { parseBlastMetadata } from './blast-metadata';
import { browserTimeZone, instantFromWallClock, wallClockInZone } from './send-time';

export type ScheduleSendMode = 'now' | 'later';

/** What the step remembers about "When should this send?". */
export interface SavedSchedule {
  mode: ScheduleSendMode;
  /** Wall clock `YYYY-MM-DDTHH:mm` in the zone restoreSchedule was given. */
  at?: string;
}

/** Kept for callers that read other metadata keys on this step. */
export const parseMetadataObject = parseBlastMetadata;

const LEGACY_WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ZONED_INSTANT = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * The stored form of a picked send time: the instant the pickers' wall clock
 * names in `timeZone` (the browser's), as ISO 8601. Undefined when the pickers
 * don't yet hold a complete, real date and time.
 */
export function scheduleInstantValue(
  date: string,
  time: string,
  timeZone: string = browserTimeZone(),
): string | undefined {
  if (!date || !time) return undefined;
  return instantFromWallClock(date, time, timeZone)?.toISOString();
}

/**
 * The saved schedule to restore, or null to keep the page's defaults.
 *
 * `at` comes back as a wall clock in `timeZone` — what the pickers edit. A
 * stored instant converts exactly; a legacy zoneless value is read in
 * `timeZone`, which is the assumption the old code made on every read too.
 *
 * A saved time that has already passed is dropped (the mode is kept): it can
 * only fail the future-only check on submit, and the default "a little from
 * now" is a better starting point than a stale one.
 */
export function restoreSchedule(
  raw: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = browserTimeZone(),
): SavedSchedule | null {
  const saved = parseBlastMetadata(raw).schedule;
  if (!saved || typeof saved !== 'object') return null;
  const { mode, at } = saved as Record<string, unknown>;
  if (mode !== 'now' && mode !== 'later') return null;
  if (typeof at !== 'string') return { mode };

  let instant: Date | null = null;
  if (LEGACY_WALL_CLOCK.test(at)) {
    instant = instantFromWallClock(at.slice(0, 10), at.slice(11, 16), timeZone);
  } else if (ZONED_INSTANT.test(at)) {
    const parsed = new Date(at);
    instant = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!instant || instant.getTime() <= now.getTime()) return { mode };

  const wall = wallClockInZone(instant, timeZone);
  return { mode, at: `${wall.date}T${wall.time}` };
}

/**
 * Merge `settings` into the draft's metadata whenever they change.
 *
 * - Waits for `ready` (the page has restored from the draft) so the defaults
 *   a page renders before hydration are never written over saved values.
 *   Pass `ready: false` for a blast that isn't a draft — it must not change.
 * - Debounced, so typing in a UTM field is one PATCH, not one per keystroke.
 * - Flushed by the header before it navigates, and on unmount.
 * - Best-effort: a failed autosave is quiet, because the final Schedule click
 *   writes the same settings itself and reports its own errors.
 */
export function useScheduleStepAutosave({
  endpoint,
  settings,
  ready,
  onSaved,
}: {
  endpoint: string;
  settings: Record<string, unknown>;
  ready: boolean;
  onSaved?: (metadata: string) => void;
}): DraftAutosave {
  return useDraftAutosave({
    key: JSON.stringify(settings),
    ready,
    save: async (key, { keepalive }) => {
      const data = await patchJson(
        endpoint,
        { metadataPatch: JSON.parse(key) as Record<string, unknown> },
        { keepalive },
      );
      const metadata = (data.campaign as { metadata?: unknown } | undefined)?.metadata;
      if (!keepalive && typeof metadata === 'string') onSaved?.(metadata);
    },
    onError: () => undefined,
  });
}
