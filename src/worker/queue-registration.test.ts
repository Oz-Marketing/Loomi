import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * Static guard over the worker's queue wiring.
 *
 * ── Why this test exists ──
 *
 * `pgboss.schedule` carries a foreign key onto `pgboss.queue`. Scheduling or
 * working a queue that was never passed to `createQueue` throws Postgres 23503
 * during boot, and because that happens inside the worker's `main()` it takes the
 * ENTIRE worker down — every unrelated cron with it — into a pm2 restart loop.
 *
 * The failure is silent in the worst way: nothing about the symptom points at the
 * missing line. Scheduled jobs simply stop running, and the app itself looks
 * healthy because the web process is fine. This has cost us the media rights
 * sweep once already, with 1,400+ restarts before anyone noticed.
 *
 * So the invariant is asserted here rather than trusted to review: any queue the
 * worker works or schedules must also be created. Reading the source is deliberate
 * — importing the module would need a live database and would only fail at boot,
 * which is exactly the outcome this is meant to prevent.
 */

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

/** Collect the identifier passed to `boss.<method>(IDENT` across the file. */
function queueArgsFor(method: string): string[] {
  const re = new RegExp(`boss\\.${method}\\(\\s*([A-Za-z_$][\\w$]*)`, 'g');
  return [...source.matchAll(re)].map((m) => m[1]);
}

const created = new Set(queueArgsFor('createQueue'));
const worked = queueArgsFor('work');
const scheduled = queueArgsFor('schedule');

describe('worker queue registration', () => {
  it('finds the queue wiring at all', () => {
    // Guards the test itself: if the worker is refactored so these calls no
    // longer match, the assertions below would pass vacuously.
    expect(created.size).toBeGreaterThan(5);
    expect(worked.length).toBeGreaterThan(5);
    expect(scheduled.length).toBeGreaterThan(5);
  });

  it('creates every queue it works', () => {
    const missing = [...new Set(worked)].filter((q) => !created.has(q));
    expect(
      missing,
      `boss.work() on queues never passed to boss.createQueue(): ${missing.join(', ')}. `
        + 'This crash-loops the whole worker at boot.',
    ).toEqual([]);
  });

  it('creates every queue it schedules', () => {
    const missing = [...new Set(scheduled)].filter((q) => !created.has(q));
    expect(
      missing,
      `boss.schedule() on queues never passed to boss.createQueue(): ${missing.join(', ')}. `
        + 'Postgres 23503 on schedule_name_fkey kills the worker at boot.',
    ).toEqual([]);
  });

  it('works every queue it schedules', () => {
    // A scheduled queue with no worker accumulates jobs forever — quieter than a
    // crash loop, and just as broken.
    const orphans = [...new Set(scheduled)].filter((q) => !worked.includes(q));
    expect(
      orphans,
      `Scheduled with no boss.work() handler: ${orphans.join(', ')}. Jobs would queue and never run.`,
    ).toEqual([]);
  });
});
