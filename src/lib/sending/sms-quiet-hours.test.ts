import { describe, expect, it } from 'vitest';
import {
  areaCodeOf,
  isAmbiguousAreaCode,
  timezonesForPhone,
} from './phone-timezone';
import {
  assessQuietHours,
  isValidTimeZone,
  isWithinQuietHours,
  nextPermittedInstant,
  resolveRecipientZones,
  zoneLabel,
  QUIET_HOURS_END_HOUR,
  QUIET_HOURS_START_HOUR,
} from './sms-quiet-hours';

// Instants are written in UTC and asserted against known local hours, so these
// tests don't depend on the machine's own timezone.
//
// Reference points (2026-06-15 is inside US DST):
//   14:00Z → 10:00 New York (EDT, -4) / 07:00 Los Angeles (PDT, -7)
//   15:00Z → 11:00 New York / 08:00 Los Angeles
//   12:00Z → 08:00 New York / 05:00 Los Angeles
const NY_10AM_LA_7AM = new Date('2026-06-15T14:00:00Z');
const NY_11AM_LA_8AM = new Date('2026-06-15T15:00:00Z');
const NY_8AM_LA_5AM = new Date('2026-06-15T12:00:00Z');
const NY_2AM = new Date('2026-06-15T06:00:00Z');

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const CHI = 'America/Chicago';

describe('areaCodeOf', () => {
  it('reads every common phone format', () => {
    expect(areaCodeOf('+14355550123')).toBe('435');
    expect(areaCodeOf('14355550123')).toBe('435');
    expect(areaCodeOf('4355550123')).toBe('435');
    expect(areaCodeOf('(435) 555-0123')).toBe('435');
    expect(areaCodeOf('435.555.0123')).toBe('435');
  });

  it('rejects anything that is not a plausible NANP number', () => {
    expect(areaCodeOf('')).toBe('');
    expect(areaCodeOf(null)).toBe('');
    expect(areaCodeOf('555')).toBe('');
    // A UK mobile must not be read as NANP.
    expect(areaCodeOf('+447911123456')).toBe('');
    // NANP area codes never begin with 0 or 1.
    expect(areaCodeOf('0355550123')).toBe('');
    expect(areaCodeOf('1355550123')).toBe('');
    // Exchange code can't begin with 0 or 1 either.
    expect(areaCodeOf('4351550123')).toBe('');
  });
});

describe('timezonesForPhone', () => {
  it('maps unambiguous area codes to one zone', () => {
    expect(timezonesForPhone('+18015550123')).toEqual(['America/Denver']);   // UT
    expect(timezonesForPhone('+12125550123')).toEqual([NY]);                 // NYC
    expect(timezonesForPhone('+13125550123')).toEqual([CHI]);                // Chicago
    expect(timezonesForPhone('+14155550123')).toEqual([LA]);                 // SF
  });

  it('keeps Arizona off DST', () => {
    expect(timezonesForPhone('+16025550123')).toEqual(['America/Phoenix']);
  });

  // Returning both halves is the whole point — see the module comment.
  it('returns every candidate for a boundary-straddling area code', () => {
    expect(timezonesForPhone('+18505550123')).toEqual([NY, CHI]); // FL panhandle
    expect(timezonesForPhone('+16055550123')).toEqual([CHI, 'America/Denver']); // SD
    expect(isAmbiguousAreaCode('+18505550123')).toBe(true);
    expect(isAmbiguousAreaCode('+12125550123')).toBe(false);
  });

  it('returns nothing for an unrecognized area code', () => {
    expect(timezonesForPhone('+19995550123')).toEqual([]);
    expect(timezonesForPhone('+447911123456')).toEqual([]);
  });
});

describe('resolveRecipientZones', () => {
  it('prefers the area code', () => {
    const r = resolveRecipientZones({
      phone: '+14155550123',
      accountTimezone: NY,
    });
    expect(r).toEqual({ zones: [LA], source: 'area-code' });
  });

  it('falls back to the account timezone when the area code is unknown', () => {
    const r = resolveRecipientZones({
      phone: '+19995550123',
      accountTimezone: 'America/Denver',
    });
    expect(r).toEqual({ zones: ['America/Denver'], source: 'account' });
  });

  it('ignores a garbage account timezone rather than throwing', () => {
    const r = resolveRecipientZones({
      phone: '+19995550123',
      accountTimezone: 'Mountain Time (US)',
    });
    expect(r.source).toBe('none');
    expect(r.zones).toEqual([]);
  });

  it('reports none when there is nothing to go on', () => {
    expect(resolveRecipientZones({ phone: null }).source).toBe('none');
  });
});

describe('isWithinQuietHours', () => {
  it('permits mid-morning', () => {
    expect(isWithinQuietHours(NY_10AM_LA_7AM, [NY])).toBe(true);
  });

  it('blocks 7am local — the case that motivated all of this', () => {
    expect(isWithinQuietHours(NY_10AM_LA_7AM, [LA])).toBe(false);
  });

  it('treats 8:00am as permitted and 2am as not', () => {
    expect(isWithinQuietHours(NY_8AM_LA_5AM, [NY])).toBe(true);
    expect(isWithinQuietHours(NY_8AM_LA_5AM, [LA])).toBe(false);
    expect(isWithinQuietHours(NY_2AM, [NY])).toBe(false);
  });

  // The intersection rule: an ambiguous code is only clear when BOTH halves are.
  it('requires every candidate zone to permit the send', () => {
    // 14:00Z is 10am Eastern (fine) but 9am Central (also fine).
    expect(isWithinQuietHours(NY_10AM_LA_7AM, [NY, CHI])).toBe(true);
    // 12:00Z is 8am Eastern (fine) but 7am Central (not).
    expect(isWithinQuietHours(NY_8AM_LA_5AM, [NY, CHI])).toBe(false);
  });

  it('permits when no zone could be determined', () => {
    expect(isWithinQuietHours(NY_2AM, [])).toBe(true);
  });

  it('uses the documented window bounds', () => {
    expect(QUIET_HOURS_START_HOUR).toBe(8);
    expect(QUIET_HOURS_END_HOUR).toBe(21);
  });
});

describe('nextPermittedInstant', () => {
  it('returns the instant unchanged when already permitted', () => {
    expect(nextPermittedInstant(NY_10AM_LA_7AM, [NY])).toEqual(NY_10AM_LA_7AM);
  });

  it('advances a 7am Los Angeles send to 8am local', () => {
    const resume = nextPermittedInstant(NY_10AM_LA_7AM, [LA]);
    expect(resume).not.toBeNull();
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: LA, hour: 'numeric', hour12: false,
    }).format(resume!);
    expect(Number(hour)).toBe(8);
    // Same day, one hour later.
    expect(resume!.getTime()).toBe(NY_11AM_LA_8AM.getTime());
  });

  it('rolls a late-night send to the next morning', () => {
    // 2026-06-16T03:00Z = 11pm Jun 15 in New York.
    const lateNight = new Date('2026-06-16T03:00:00Z');
    const resume = nextPermittedInstant(lateNight, [NY])!;
    expect(resume.getTime()).toBeGreaterThan(lateNight.getTime());
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: NY, hour: 'numeric', hour12: false, day: 'numeric',
    }).formatToParts(resume);
    expect(Number(parts.find((p) => p.type === 'hour')!.value)).toBe(8);
    expect(Number(parts.find((p) => p.type === 'day')!.value)).toBe(16);
    // 11pm → 8am is exactly nine hours; the point is it doesn't skip a day.
    expect(resume.getTime() - lateNight.getTime()).toBe(9 * 3600_000);
  });

  it('passes an unknown zone straight through', () => {
    expect(nextPermittedInstant(NY_2AM, [])).toEqual(NY_2AM);
  });

  it('finds a slot satisfying two zones at once', () => {
    const resume = nextPermittedInstant(NY_8AM_LA_5AM, [NY, CHI])!;
    expect(resume).not.toBeNull();
    for (const zone of [NY, CHI]) {
      const hour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour: 'numeric', hour12: false,
      }).format(resume));
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(21);
    }
  });
});

describe('assessQuietHours', () => {
  it('splits a multi-timezone list into permitted and held', () => {
    // 14:00Z: 10am in NYC (ok), 7am in SF (held).
    const result = assessQuietHours(
      [
        { phone: '+12125550123' },  // NY
        { phone: '+12125550124' },  // NY
        { phone: '+14155550123' },  // LA
      ],
      NY_10AM_LA_7AM,
    );
    expect(result.permitted).toBe(2);
    expect(result.held).toBe(1);
    expect(result.earliestResume?.getTime()).toBe(NY_11AM_LA_8AM.getTime());
    expect(result.zonesRepresented).toEqual([LA, NY]);
  });

  it('counts unknown zones separately and does not hold them', () => {
    const result = assessQuietHours([{ phone: '+447911123456' }], NY_2AM);
    expect(result.unknownZone).toBe(1);
    expect(result.held).toBe(0);
    expect(result.permitted).toBe(1);
  });

  it('uses the account timezone for unknown area codes when given one', () => {
    // 14:00Z is 7am in Los Angeles, so an unknown number on an LA account holds.
    const result = assessQuietHours(
      [{ phone: '+19995550123' }],
      NY_10AM_LA_7AM,
      LA,
    );
    expect(result.unknownZone).toBe(0);
    expect(result.held).toBe(1);
  });

  it('flags ambiguous area codes', () => {
    const result = assessQuietHours([{ phone: '+18505550123' }], NY_11AM_LA_8AM);
    expect(result.ambiguousZone).toBe(1);
  });

  it('reports an all-clear for a wholly compliant list', () => {
    const result = assessQuietHours(
      [{ phone: '+12125550123' }, { phone: '+13125550123' }],
      NY_10AM_LA_7AM,
    );
    expect(result.held).toBe(0);
    expect(result.earliestResume).toBeNull();
  });

  it('handles an empty list', () => {
    const result = assessQuietHours([], NY_10AM_LA_7AM);
    expect(result).toMatchObject({ permitted: 0, held: 0, unknownZone: 0 });
  });
});

describe('isValidTimeZone / zoneLabel', () => {
  it('accepts real IANA zones and rejects prose', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true);
    expect(isValidTimeZone('Mountain Time')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it('renders a readable label', () => {
    expect(zoneLabel('America/Los_Angeles')).toBe('Los Angeles');
    expect(zoneLabel('America/New_York')).toBe('New York');
  });
});
