import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bulkSkipSummary,
  isInFlightBlastStatus,
  partitionBulkTargets,
  pausedSendReason,
  renameBlast,
} from './blast-list-actions';

describe('isInFlightBlastStatus', () => {
  it('flags anything with a send still ahead of it', () => {
    for (const s of ['queued', 'scheduled', 'processing', 'Scheduled', 'running']) {
      expect(isInFlightBlastStatus(s)).toBe(true);
    }
    for (const s of ['draft', 'completed', 'partial', 'failed', 'canceled', '']) {
      expect(isInFlightBlastStatus(s)).toBe(false);
    }
  });
});

// Bulk Archive used to archive a scheduled blast — hiding it while it still sent.
describe('partitionBulkTargets', () => {
  it('holds back in-flight and non-Loomi rows', () => {
    const rows = [
      { id: 'draft', provider: 'loomi-email', status: 'draft' },
      { id: 'sched', provider: 'loomi-email', status: 'scheduled' },
      { id: 'sending', provider: 'loomi-sms', status: 'processing' },
      { id: 'sent', provider: 'loomi-sms', status: 'completed' },
      { id: 'flow', provider: 'loomi-email', status: 'completed', isFlow: true },
      { id: 'esp', provider: 'mailchimp', status: 'sent' },
    ];
    const out = partitionBulkTargets(rows);
    expect(out.actionable.map((r) => r.id)).toEqual(['draft', 'sent']);
    expect(out.inFlight.map((r) => r.id)).toEqual(['sched', 'sending']);
    expect(out.unmanaged.map((r) => r.id)).toEqual(['flow', 'esp']);
  });
});

describe('bulkSkipSummary', () => {
  it('says what was skipped and why', () => {
    expect(bulkSkipSummary({ inFlight: [1], unmanaged: [] })).toEqual([
      '1 blast skipped because it is scheduled or sending — cancel it first.',
    ]);
    expect(bulkSkipSummary({ inFlight: [1, 2], unmanaged: [1] })).toEqual([
      '2 blasts skipped because they are scheduled or sending — cancel them first.',
      '1 row skipped (managed outside Loomi or by a flow).',
    ]);
    expect(bulkSkipSummary({ inFlight: [], unmanaged: [] })).toEqual([]);
  });
});

describe('renameBlast', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (metadata: unknown) =>
    new Response(JSON.stringify({ campaign: { metadata: JSON.stringify(metadata) } }), { status: 200 });

  it('renames both halves of an email + text pair', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/email/') ? ok({ multiChannel: true, linkedSmsBlastId: 's1' }) : ok({}),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await renameBlast('multi', 'e1', 'Fall Sale')).toEqual({});
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/blasts/email/e1', '/api/blasts/sms/s1']);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(JSON.parse(String(init.body))).toEqual({ name: 'Fall Sale' });
    }
  });

  it('renames a lone email once', async () => {
    const fetchMock = vi.fn(async () => ok({ templateSlug: 't' }));
    vi.stubGlobal('fetch', fetchMock);
    await renameBlast('email', 'e1', 'X');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a text half that kept its old name without failing the rename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/email/')
          ? ok({ multiChannel: true, linkedSmsBlastId: 's1' })
          : new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
      ),
    );
    const out = await renameBlast('multi', 'e1', 'X');
    expect(out.partnerError).toMatch(/text kept its old name: nope/);
  });

  it('throws when the named half fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    await expect(renameBlast('sms', 's1', 'X')).rejects.toThrow('Forbidden');
  });
});

describe('pausedSendReason', () => {
  it('surfaces a pause the send engine recorded on a pending blast', () => {
    expect(pausedSendReason('scheduled', 'Paused: SendGrid rejected the API key.')).toBe(
      'SendGrid rejected the API key.',
    );
    expect(pausedSendReason('processing', 'paused: Twilio is down')).toBe('Twilio is down');
    expect(pausedSendReason('queued', 'Paused:')).toBe('Sending is paused.');
  });

  it('ignores ordinary errors and finished blasts', () => {
    expect(pausedSendReason('scheduled', 'Some other error')).toBeNull();
    expect(pausedSendReason('scheduled', '')).toBeNull();
    expect(pausedSendReason('failed', 'Paused: stale')).toBeNull();
    expect(pausedSendReason('completed', 'Paused: stale')).toBeNull();
  });
});
