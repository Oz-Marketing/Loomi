import { describe, it, expect } from 'vitest';
import {
  approvalIsCurrent,
  approvalLabel,
  resolveTemplateApproval,
  type ApprovalRow,
} from './coop-approval';

const HASH = 'abc123def4567890';

function row(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'a1',
    make: 'Chevrolet',
    docHash: HASH,
    packVersion: '2026-Q3',
    reference: 'CO-OP-4471',
    approvedByName: 'Connor Kelly',
    approvedAt: new Date('2026-08-01T12:00:00Z'),
    revokedAt: null,
    ...over,
  };
}

describe('resolveTemplateApproval', () => {
  it('reports no approval when none is on file', () => {
    const s = resolveTemplateApproval([], { docHash: HASH, make: 'Chevrolet' });
    expect(s.state).toBe('none');
    expect(approvalIsCurrent(s)).toBe(false);
    expect(s.reason).toContain('Chevrolet');
  });

  it('is current when the design and the guideline edition both match', () => {
    const s = resolveTemplateApproval([row()], {
      docHash: HASH,
      make: 'Chevrolet',
      activePackVersion: '2026-Q3',
    });
    expect(s.state).toBe('current');
    expect(approvalIsCurrent(s)).toBe(true);
    expect(s.reason).toContain('Connor Kelly');
    expect(s.reason).toContain('CO-OP-4471');
  });

  it('goes stale when the template has been edited since approval', () => {
    // The whole reason approval carries a design hash: it must not survive a
    // redesign the manufacturer never saw.
    const s = resolveTemplateApproval([row()], { docHash: 'a-different-design', make: 'Chevrolet' });
    expect(s.state).toBe('stale_design');
    expect(approvalIsCurrent(s)).toBe(false);
    expect(s.reason).toContain('edited since');
  });

  it('goes stale when the make has reissued its guidelines', () => {
    const s = resolveTemplateApproval([row({ packVersion: '2026-Q2' })], {
      docHash: HASH,
      make: 'Chevrolet',
      activePackVersion: '2026-Q3',
    });
    expect(s.state).toBe('stale_pack');
    expect(s.reason).toContain('2026-Q2');
    expect(s.reason).toContain('2026-Q3');
  });

  it('does not claim pack staleness when no pack is on file', () => {
    // With no current edition to compare against, calling an approval stale would
    // be an assertion about rules nobody has.
    const s = resolveTemplateApproval([row({ packVersion: '2026-Q1' })], {
      docHash: HASH,
      make: 'Chevrolet',
    });
    expect(s.state).toBe('current');
  });

  it('does not claim pack staleness when the approval names no edition', () => {
    const s = resolveTemplateApproval([row({ packVersion: null })], {
      docHash: HASH,
      make: 'Chevrolet',
      activePackVersion: '2026-Q3',
    });
    expect(s.state).toBe('current');
  });

  it('reports a withdrawal, and keeps it distinct from never-approved', () => {
    const s = resolveTemplateApproval(
      [row({ revokedAt: new Date('2026-08-04T00:00:00Z'), revokedByName: 'Connor Kelly' })],
      { docHash: HASH, make: 'Chevrolet' },
    );
    expect(s.state).toBe('revoked');
    expect(s.reason).toContain('withdrawn');
    expect(s.reason).toContain('Connor Kelly');
  });

  it('lets a re-approval supersede a withdrawn one', () => {
    const s = resolveTemplateApproval(
      [
        row({ id: 'old', revokedAt: new Date('2026-08-02T00:00:00Z') }),
        row({ id: 'new', approvedAt: new Date('2026-08-05T00:00:00Z') }),
      ],
      { docHash: HASH, make: 'Chevrolet' },
    );
    expect(s.state).toBe('current');
    expect(s.approval?.id).toBe('new');
  });

  it('takes the newest live approval when a template was re-approved after a redesign', () => {
    const s = resolveTemplateApproval(
      [
        row({ id: 'first', docHash: 'old-design', approvedAt: new Date('2026-07-01T00:00:00Z') }),
        row({ id: 'second', docHash: HASH, approvedAt: new Date('2026-08-01T00:00:00Z') }),
      ],
      { docHash: HASH, make: 'Chevrolet' },
    );
    expect(s.state).toBe('current');
    expect(s.approval?.id).toBe('second');
  });

  it('scopes to the make — a Honda approval does not cover a Chevrolet ad', () => {
    // A shared plate can be approved by several manufacturers independently, so
    // leaking one make's approval to another is the dangerous failure here.
    const s = resolveTemplateApproval([row({ make: 'Honda' })], { docHash: HASH, make: 'Chevrolet' });
    expect(s.state).toBe('none');
  });

  it('matches the make case-insensitively', () => {
    const s = resolveTemplateApproval([row({ make: 'chevrolet ' })], { docHash: HASH, make: 'Chevrolet' });
    expect(s.state).toBe('current');
  });

  it('keeps each make independent on a multi-brand plate', () => {
    const rows = [row({ id: 'chev', make: 'Chevrolet' }), row({ id: 'honda', make: 'Honda', docHash: 'stale' })];
    expect(resolveTemplateApproval(rows, { docHash: HASH, make: 'Chevrolet' }).state).toBe('current');
    expect(resolveTemplateApproval(rows, { docHash: HASH, make: 'Honda' }).state).toBe('stale_design');
  });
});

describe('approvalLabel', () => {
  it('gives a short label for every state', () => {
    expect(approvalLabel('current')).toBe('Co-op approved');
    expect(approvalLabel('stale_design')).toBe('Approval out of date');
    expect(approvalLabel('stale_pack')).toBe('Guidelines reissued');
    expect(approvalLabel('revoked')).toBe('Approval withdrawn');
    expect(approvalLabel('none')).toBe('Not approved');
  });
});
