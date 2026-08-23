import { describe, it, expect } from 'vitest';
import { diffBlocking } from './sweep';

/**
 * What the nightly sweep is allowed to page someone about.
 *
 * Both rules here are about an alert's survival rather than its correctness. An
 * alert that repeats a standing backlog every morning gets muted, and once it is
 * muted the one morning something real breaks looks identical to the thirty
 * before it. So the sweep announces differences only — and announces nothing at
 * all on its first run, when every pre-existing failure would otherwise read as
 * overnight news.
 */
describe('diffBlocking', () => {
  it('says nothing on the first ever sweep, however much is broken', () => {
    expect(
      diffBlocking({
        current: ['a:meta.ad_account', 'b:pacer.plan', 'c:adgen.template_map'],
        previous: [],
        hadPreviousRun: false,
      }),
    ).toEqual([]);
  });

  it('reports only what appeared since the last sweep', () => {
    expect(
      diffBlocking({
        current: ['a:meta.ad_account', 'b:pacer.plan'],
        previous: ['a:meta.ad_account'],
        hadPreviousRun: true,
      }),
    ).toEqual(['b:pacer.plan']);
  });

  it('stays silent when a standing backlog is unchanged', () => {
    const standing = ['a:meta.ad_account', 'b:pacer.plan'];
    expect(diffBlocking({ current: standing, previous: standing, hadPreviousRun: true })).toEqual([]);
  });

  it('does not report a failure that was FIXED', () => {
    // Something going green is good news, and good news is not an alert.
    expect(
      diffBlocking({
        current: ['a:meta.ad_account'],
        previous: ['a:meta.ad_account', 'b:pacer.plan'],
        hadPreviousRun: true,
      }),
    ).toEqual([]);
  });

  it('re-reports a failure that came back after being fixed', () => {
    expect(
      diffBlocking({
        current: ['a:meta.ad_account'],
        previous: ['b:pacer.plan'],
        hadPreviousRun: true,
      }),
    ).toEqual(['a:meta.ad_account']);
  });

  it('treats the same check on a different rooftop as a new failure', () => {
    // The key is account-scoped for exactly this reason: Young Ford losing its
    // Page is not covered by Young Chevrolet having lost its Page last week.
    expect(
      diffBlocking({
        current: ['youngChev:meta.page_confirmed', 'youngFord:meta.page_confirmed'],
        previous: ['youngChev:meta.page_confirmed'],
        hadPreviousRun: true,
      }),
    ).toEqual(['youngFord:meta.page_confirmed']);
  });

  it('reports everything when a previous run recorded nothing broken', () => {
    // A previous run that was CLEAN is still a previous run — an empty backlog
    // is a fact, not a missing baseline.
    expect(
      diffBlocking({
        current: ['a:meta.ad_account'],
        previous: [],
        hadPreviousRun: true,
      }),
    ).toEqual(['a:meta.ad_account']);
  });
});
