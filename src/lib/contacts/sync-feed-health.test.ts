import { describe, it, expect } from 'vitest';
import { feedStatus, type ReportingFeedDef } from './sync-feed-health';

const live: ReportingFeedDef = { kind: 'calls', label: 'Calls', staleIsFailure: true, note: '' };
const episodic: ReportingFeedDef = { ...live, kind: 'mailer', staleIsFailure: false };
const pending: ReportingFeedDef = { ...live, awaitingProducer: 'not built' };

describe('feedStatus', () => {
  it('fails a live feed that has never run', () => {
    expect(feedStatus(live, null, 30)).toEqual({ status: 'never-run', failing: true });
  });

  it('only warns for a never-run feed whose producer does not exist yet', () => {
    expect(feedStatus(pending, null, 30)).toEqual({ status: 'awaiting-producer', failing: false });
  });

  it('arms an awaiting-producer feed as soon as it has delivered a batch', () => {
    expect(feedStatus(pending, 2, 30)).toEqual({ status: 'ok', failing: false });
    expect(feedStatus(pending, 31, 30)).toEqual({ status: 'stale', failing: true });
  });

  it('fails stale only where staleIsFailure', () => {
    expect(feedStatus(live, 31, 30)).toEqual({ status: 'stale', failing: true });
    expect(feedStatus(episodic, 31, 30)).toEqual({ status: 'stale', failing: false });
  });

  it('is ok inside the window', () => {
    expect(feedStatus(live, 30, 30)).toEqual({ status: 'ok', failing: false });
  });
});
