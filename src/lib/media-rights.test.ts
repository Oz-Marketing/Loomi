import { describe, it, expect } from 'vitest';
import {
  assessRights,
  daysUntil,
  dueWarning,
  governingExpiry,
  isLicenseType,
  rightsBadgeLabel,
} from './media-rights';

const NOW = new Date('2026-08-11T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe('governingExpiry', () => {
  it('takes whichever date comes first', () => {
    expect(governingExpiry({ licenseExpiresAt: inDays(60), expiresAt: inDays(10) })).toEqual({
      date: inDays(10),
      reason: 'effective',
    });
    expect(governingExpiry({ licenseExpiresAt: inDays(10), expiresAt: inDays(60) })).toEqual({
      date: inDays(10),
      reason: 'license',
    });
  });

  it('resolves a tie to the licence — the legal constraint, not the operational one', () => {
    const d = inDays(30);
    expect(governingExpiry({ licenseExpiresAt: d, expiresAt: d }).reason).toBe('license');
  });

  it('uses whichever single date is present', () => {
    expect(governingExpiry({ licenseExpiresAt: inDays(5) }).reason).toBe('license');
    expect(governingExpiry({ expiresAt: inDays(5) }).reason).toBe('effective');
    expect(governingExpiry({})).toEqual({ date: null, reason: null });
  });
});

describe('assessRights', () => {
  it('reports unknown when nothing is recorded — not active', () => {
    // The distinction this phase exists for: no licence on file is an open
    // question, not a clearance.
    const a = assessRights({}, NOW);
    expect(a.status).toBe('unknown');
    expect(a.daysRemaining).toBeNull();
  });

  it('is active well ahead of the window', () => {
    expect(assessRights({ licenseExpiresAt: inDays(90) }, NOW).status).toBe('active');
  });

  it('flags expiring_soon inside 30 days', () => {
    expect(assessRights({ licenseExpiresAt: inDays(30) }, NOW).status).toBe('expiring_soon');
    expect(assessRights({ licenseExpiresAt: inDays(1) }, NOW).status).toBe('expiring_soon');
  });

  it('is expired during the grace period and lapsed after it', () => {
    expect(assessRights({ licenseExpiresAt: inDays(-1) }, NOW).status).toBe('expired');
    expect(assessRights({ licenseExpiresAt: inDays(-14) }, NOW).status).toBe('expired');
    expect(assessRights({ licenseExpiresAt: inDays(-15) }, NOW).status).toBe('lapsed');
  });

  it('reports which date governs', () => {
    const a = assessRights({ licenseExpiresAt: inDays(60), expiresAt: inDays(3) }, NOW);
    expect(a.reason).toBe('effective');
    expect(a.daysRemaining).toBe(3);
  });

  it('lets a manual expiry win over a licence that still runs', () => {
    // Someone pulled it deliberately; a live licence doesn't undo that.
    const a = assessRights(
      { licenseExpiresAt: inDays(90), expiredAt: inDays(-1), expirationReason: 'manual' },
      NOW,
    );
    expect(a.status).toBe('expired');
    expect(a.reason).toBe('manual');
  });

  it('handles ISO strings as well as Dates', () => {
    const a = assessRights({ licenseExpiresAt: inDays(5).toISOString() }, NOW);
    expect(a.status).toBe('expiring_soon');
    expect(a.daysRemaining).toBe(5);
  });

  it('ignores an unparseable date rather than throwing', () => {
    expect(assessRights({ licenseExpiresAt: 'not-a-date' }, NOW).status).toBe('unknown');
  });
});

describe('rightsBadgeLabel', () => {
  it('counts down rather than saying "expiring soon"', () => {
    expect(rightsBadgeLabel(assessRights({ expiresAt: inDays(12) }, NOW))).toBe('12 days left');
    expect(rightsBadgeLabel(assessRights({ expiresAt: inDays(1) }, NOW))).toBe('1 day left');
  });

  it('badges expired and lapsed', () => {
    expect(rightsBadgeLabel(assessRights({ expiresAt: inDays(-2) }, NOW))).toBe('Expired');
    expect(rightsBadgeLabel(assessRights({ expiresAt: inDays(-40) }, NOW))).toBe('Lapsed');
  });

  it('badges nothing for active or unknown', () => {
    // Otherwise every untouched asset in the library wears a warning.
    expect(rightsBadgeLabel(assessRights({ expiresAt: inDays(200) }, NOW))).toBeNull();
    expect(rightsBadgeLabel(assessRights({}, NOW))).toBeNull();
  });
});

describe('dueWarning', () => {
  it('fires at the 30-day band when nothing has been sent', () => {
    expect(dueWarning(assessRights({ expiresAt: inDays(25) }, NOW), null, NOW)).toBe(30);
  });

  it('fires at 7 when inside a week', () => {
    expect(dueWarning(assessRights({ expiresAt: inDays(5) }, NOW), null, NOW)).toBe(7);
  });

  it('stays quiet on later sweeps within the same band', () => {
    // Warned three days ago at 28 days out; now 25 days out — still the 30 band.
    const a = assessRights({ expiresAt: inDays(25) }, NOW);
    expect(dueWarning(a, inDays(-3), NOW)).toBeNull();
  });

  it('fires again once the asset drops into a tighter band', () => {
    // Warned 20 days ago when 26 days remained (the 30 band); now 6 days out.
    const a = assessRights({ expiresAt: inDays(6) }, NOW);
    expect(dueWarning(a, inDays(-20), NOW)).toBe(7);
  });

  it('says nothing for assets that are not expiring soon', () => {
    expect(dueWarning(assessRights({ expiresAt: inDays(120) }, NOW), null, NOW)).toBeNull();
    expect(dueWarning(assessRights({ expiresAt: inDays(-1) }, NOW), null, NOW)).toBeNull();
    expect(dueWarning(assessRights({}, NOW), null, NOW)).toBeNull();
  });
});

describe('vocabulary guards and daysUntil', () => {
  it('rejects unknown licence types', () => {
    expect(isLicenseType('oem-licensed')).toBe(true);
    expect(isLicenseType('OEM-licensed')).toBe(false);
    expect(isLicenseType('perpetual')).toBe(false);
  });

  it('counts whole days, negative once passed', () => {
    expect(daysUntil(inDays(3), NOW)).toBe(3);
    expect(daysUntil(inDays(-3), NOW)).toBe(-3);
  });
});
