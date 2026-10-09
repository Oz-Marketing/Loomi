import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, RETRY_AFTER_MS, clientFor, intakeAction, intakeFingerprint } from './intake';
import type { ReadyDeliverable } from './monday-board';

const NOW = new Date('2026-10-09T18:00:00Z');

function ready(overrides: Partial<ReadyDeliverable> = {}): ReadyDeliverable {
  return {
    id: '1',
    name: 'Email Blast 1 - Young Powersports Euro',
    kind: 'email',
    updatedAt: null,
    projectId: 'p',
    projectName: 'YPS Euro & Ogden',
    clients: ['Young Powersports Euro'],
    coop: 'no',
    designAssetIds: ['501'],
    hasDraftFiles: false,
    hasTemplateLink: false,
    ...overrides,
  };
}

const fp = intakeFingerprint(ready());
const prior = (status: string, extra: Partial<{ attempts: number; intakeFingerprint: string | null; updatedAt: Date }> = {}) => ({
  status,
  attempts: 1,
  intakeFingerprint: fp,
  updatedAt: new Date(NOW.getTime() - RETRY_AFTER_MS - 1),
  ...extra,
});

describe('intakeAction', () => {
  it('starts a new email deliverable', () => {
    expect(intakeAction(ready(), null, fp, NOW)).toEqual({ kind: 'start' });
  });

  it('leaves alone what someone already built by hand, and what isn’t email', () => {
    expect(intakeAction(ready({ hasDraftFiles: true }), null, fp, NOW).kind).toBe('skip');
    expect(intakeAction(ready({ hasTemplateLink: true }), null, fp, NOW).kind).toBe('skip');
    expect(intakeAction(ready({ kind: 'text' }), null, fp, NOW).kind).toBe('skip');
  });

  it('never restarts a request that is moving or done', () => {
    for (const status of ['queued', 'fetching', 'awaiting_extraction', 'in_proofing', 'approved']) {
      expect(intakeAction(ready(), prior(status), fp, NOW).kind, status).toBe('skip');
    }
  });

  it('retries a stopped request as soon as what it is made from changes', () => {
    const changed = intakeFingerprint(ready({ designAssetIds: ['502'] }));
    expect(intakeAction(ready(), prior('needs_account', { updatedAt: NOW }), changed, NOW)).toEqual({ kind: 'start' });
    expect(intakeAction(ready(), prior('failed', { updatedAt: NOW }), changed, NOW)).toEqual({ kind: 'start' });
  });

  it('retries a failure quietly, a bounded number of times, never a missing account', () => {
    expect(intakeAction(ready(), prior('failed'), fp, NOW)).toEqual({ kind: 'start' });
    expect(intakeAction(ready(), prior('failed', { updatedAt: NOW }), fp, NOW).kind).toBe('skip');
    expect(intakeAction(ready(), prior('failed', { attempts: MAX_ATTEMPTS }), fp, NOW).kind).toBe('skip');
    expect(intakeAction(ready(), prior('needs_account'), fp, NOW).kind).toBe('skip');
  });
});

describe('intakeFingerprint', () => {
  it('ignores asset order but not the assets or the client', () => {
    expect(intakeFingerprint(ready({ designAssetIds: ['1', '2'] }))).toBe(intakeFingerprint(ready({ designAssetIds: ['2', '1'] })));
    expect(intakeFingerprint(ready({ clients: ['Young Powersports Ogden'] }))).not.toBe(fp);
  });
});

describe('clientFor', () => {
  it('takes the one client a deliverable is for', () => {
    expect(clientFor(ready())).toEqual({ name: 'Young Powersports Euro', problem: null });
  });

  it('can’t pick for a subitem when the request names several clients', () => {
    expect(clientFor(ready({ clients: ['Young Powersports Ogden', 'Young Powersports Euro'] })).problem).toMatch(
      /names 2 clients .* doesn't say which one/,
    );
  });
});
