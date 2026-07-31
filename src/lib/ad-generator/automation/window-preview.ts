/**
 * The dates a run-window mode resolves to, as a label for the settings UI.
 *
 * "Next month" is abstract until you see it means an offer has to stay valid to
 * the 31st — which is the whole reason a GM programme ending on the 3rd reads
 * as Partial. Showing the range under the picker makes the setting legible.
 *
 * This deliberately duplicates the arithmetic in {@link runWindowFor} /
 * {@link monthWindow} rather than importing them: `offer-timing.ts` reaches
 * `fingerprint.ts`, which imports `node:crypto`, and this runs in the browser.
 * `window-preview.test.ts` asserts the two agree across month boundaries and
 * timezones, so the copy can't drift silently.
 *
 * UTC throughout, matching the server. Local-time constructors land a day out
 * west of UTC on the first and last of the month — precisely the boundary this
 * feature turns on.
 *
 * No imports: this module must stay safe for a client bundle.
 */

const DAY = 86_400_000;

/** Days a `rolling` window covers. The only value the settings UI can set. */
export const DEFAULT_ROLLING_DAYS = 30;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** e.g. `2026-08-01 → 2026-08-31`. */
export function windowPreview(mode: string, now = new Date(), rollingDays = DEFAULT_ROLLING_DAYS): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (mode === 'rolling') {
    const start = new Date(Date.UTC(y, m, now.getUTCDate()));
    return `${iso(start)} → ${iso(new Date(start.getTime() + rollingDays * DAY))}`;
  }
  // Anything that isn't `current_month` or `rolling` falls through to next
  // month, the same default `runWindowFor` applies to an unrecognised mode.
  const off = mode === 'current_month' ? 0 : 1;
  return `${iso(new Date(Date.UTC(y, m + off, 1)))} → ${iso(new Date(Date.UTC(y, m + off + 1, 0)))}`;
}
