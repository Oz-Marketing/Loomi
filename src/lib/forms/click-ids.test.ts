// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  LP_CLICK_COOKIE,
  MAX_CLICK_ID_LENGTH,
  clickIdsFromSearch,
  mergeClickIds,
  parseClickIdCookie,
  parseClickIdParams,
  readLpClickCookie,
  sanitizeClickId,
  takeClickIdFields,
} from './click-ids';

describe('sanitizeClickId', () => {
  it('keeps real-shaped ids verbatim', () => {
    expect(sanitizeClickId('Cj0KCQjw-abc_DEF.123')).toBe('Cj0KCQjw-abc_DEF.123');
    expect(sanitizeClickId('abc_123')).toBe('abc_123');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeClickId('  abc_123  ')).toBe('abc_123');
  });

  it('drops — never repairs — anything with another character', () => {
    // A "cleaned" id is a different id; uploading it would credit nothing.
    for (const bad of ['abc 123', 'abc<script>', 'a%20b', 'abc;def', 'naïve', 'a+b', 'a/b']) {
      expect(sanitizeClickId(bad), bad).toBeNull();
    }
  });

  it('drops an over-long value instead of truncating it', () => {
    expect(sanitizeClickId('a'.repeat(MAX_CLICK_ID_LENGTH))).toHaveLength(MAX_CLICK_ID_LENGTH);
    expect(sanitizeClickId('a'.repeat(MAX_CLICK_ID_LENGTH + 1))).toBeNull();
  });

  it('drops empty and non-string values', () => {
    for (const bad of ['', '   ', undefined, null, 42, ['abc'], { v: 'abc' }]) {
      expect(sanitizeClickId(bad)).toBeNull();
    }
  });
});

describe('parseClickIdParams', () => {
  it('reads the five ids off a form URL and ignores everything else', () => {
    expect(
      parseClickIdParams({
        gclid: 'G1',
        gbraid: 'abc_123',
        wbraid: 'W1',
        fbclid: 'F1',
        msclkid: 'M1',
        utm_source: 'google',
        dclid: 'D1',
      }),
    ).toEqual({ gclid: 'G1', gbraid: 'abc_123', wbraid: 'W1', fbclid: 'F1', msclkid: 'M1' });
  });

  it('takes the first of a repeated param, and drops invalid ones', () => {
    expect(parseClickIdParams({ gclid: ['FIRST', 'SECOND'], gbraid: 'bad value' })).toEqual({
      gclid: 'FIRST',
    });
  });
});

describe('clickIdsFromSearch', () => {
  it('parses a location.search string', () => {
    expect(clickIdsFromSearch('?utm_source=x&gbraid=abc_123&fbclid=IwAR0')).toEqual({
      gbraid: 'abc_123',
      fbclid: 'IwAR0',
    });
  });
});

describe('mergeClickIds', () => {
  it('lets the URL win, network by network', () => {
    expect(mergeClickIds({ gclid: 'URL' }, { gclid: 'COOKIE', fbclid: 'COOKIE_FB' })).toEqual({
      gclid: 'URL',
      fbclid: 'COOKIE_FB',
    });
  });

  it('takes Google ids from one side only', () => {
    // A gbraid on the URL is this visit's click; an older cookie gclid
    // must not ride along with it.
    expect(mergeClickIds({ gbraid: 'URL_BRAID' }, { gclid: 'OLD_GCLID', wbraid: 'OLD_W' })).toEqual({
      gbraid: 'URL_BRAID',
    });
  });

  it('falls back entirely when the URL has nothing', () => {
    expect(mergeClickIds({}, { gclid: 'C', msclkid: 'M' })).toEqual({ gclid: 'C', msclkid: 'M' });
    expect(mergeClickIds(undefined, undefined)).toEqual({});
  });
});

describe('parseClickIdCookie', () => {
  it('reads the JSON the LP tracker writes', () => {
    expect(parseClickIdCookie('{"gclid":"G1","fbclid":"F1"}')).toEqual({ gclid: 'G1', fbclid: 'F1' });
  });

  it('returns {} for anything malformed, and re-validates each id', () => {
    expect(parseClickIdCookie('not json')).toEqual({});
    expect(parseClickIdCookie('["G1"]')).toEqual({});
    expect(parseClickIdCookie('null')).toEqual({});
    expect(parseClickIdCookie('{"gclid":"bad value","wbraid":"W1","evil":"x"}')).toEqual({ wbraid: 'W1' });
  });
});

describe('readLpClickCookie', () => {
  afterEach(() => {
    document.cookie = `${LP_CLICK_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it('reads the encoded cookie back', () => {
    document.cookie = `${LP_CLICK_COOKIE}=${encodeURIComponent('{"gbraid":"abc_123"}')}; path=/`;
    expect(readLpClickCookie()).toEqual({ gbraid: 'abc_123' });
  });

  it('is {} with no cookie or an undecodable one', () => {
    expect(readLpClickCookie()).toEqual({});
    document.cookie = `${LP_CLICK_COOKIE}=%E0%A4%A; path=/`;
    expect(readLpClickCookie()).toEqual({});
  });
});

describe('takeClickIdFields', () => {
  it('pulls every __loomi_click_* field out of the payload and keeps the valid ids', () => {
    const raw: Record<string, unknown> = {
      email: 'lead@example.com',
      __loomi_click_gbraid: 'abc_123',
      __loomi_click_gclid: 'bad<value>',
      __loomi_click_fbclid: ['IwAR0', 'IwAR1'],
      __loomi_click_whatever: 'x',
      __loomi_utm_source: 'google',
    };
    expect(takeClickIdFields(raw)).toEqual({ gbraid: 'abc_123' });
    // Stripped — none of them may land in submission.data — while other
    // hidden fields are left for their own extractors.
    expect(raw).toEqual({ email: 'lead@example.com', __loomi_utm_source: 'google' });
  });
});
