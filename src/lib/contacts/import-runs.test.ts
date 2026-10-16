import { describe, it, expect } from 'vitest';
import type { ContactImportRun } from '@prisma/client';
import { canImportForAccount, serializeImportRun } from './import-runs';

function run(overrides: Partial<ContactImportRun> = {}): ContactImportRun {
  const at = new Date('2026-10-16T12:00:00Z');
  return {
    id: 'run1',
    accountKey: 'acctA',
    startedByUserId: 'u1',
    fileName: 'leads.csv',
    status: 'running',
    csvText: 'email\nsomeone@example.com',
    mapping: '{"email":"email"}',
    listId: null,
    applyTags: null,
    preserveExisting: false,
    totalRows: 100,
    processedRows: 50,
    imported: 40,
    updated: 10,
    skipped: 0,
    optedOutEmail: 0,
    optedOutSms: 0,
    listMembershipsAdded: 0,
    issues: null,
    error: null,
    startedAt: at,
    updatedAt: at,
    finishedAt: null,
    ...overrides,
  };
}

describe('serializeImportRun', () => {
  it('never carries the stored file or mapping to the browser', () => {
    const dto = serializeImportRun(run(), Date.parse('2026-10-16T12:00:05Z'));
    const json = JSON.stringify(dto);
    expect(json).not.toContain('someone@example.com');
    expect(dto).not.toHaveProperty('csvText');
    expect(dto).not.toHaveProperty('mapping');
  });

  it('flags a running import that has stopped moving', () => {
    const fresh = serializeImportRun(run(), Date.parse('2026-10-16T12:01:00Z'));
    const stale = serializeImportRun(run(), Date.parse('2026-10-16T12:30:00Z'));
    expect(fresh.stalled).toBe(false);
    expect(stale.stalled).toBe(true);
    expect(serializeImportRun(run({ status: 'done' }), Date.parse('2026-10-17T00:00:00Z')).stalled).toBe(false);
  });

  it('tolerates a malformed issues blob', () => {
    expect(serializeImportRun(run({ issues: 'not json' })).issues).toEqual([]);
  });
});

describe('canImportForAccount', () => {
  it('holds assigned users to their accounts', () => {
    expect(canImportForAccount({ role: 'admin', accountKeys: ['acctA'] }, 'acctA')).toBe(true);
    expect(canImportForAccount({ role: 'admin', accountKeys: ['acctA'] }, 'acctB')).toBe(false);
    expect(canImportForAccount({ role: 'user', accountKeys: [] }, 'acctA')).toBe(false);
  });

  it('lets developers and unassigned admins reach every account', () => {
    expect(canImportForAccount({ role: 'developer', accountKeys: [] }, 'acctB')).toBe(true);
    expect(canImportForAccount({ role: 'admin', accountKeys: [] }, 'acctB')).toBe(true);
  });
});
