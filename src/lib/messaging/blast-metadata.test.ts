import { describe, expect, it } from 'vitest';
import {
  mergeBlastMetadata,
  parseBlastMetadata,
  readLinkedSmsId,
  readMetadataPatch,
  readTemplateSlug,
} from './blast-metadata';

describe('parseBlastMetadata', () => {
  it('reads an object and treats everything else as empty', () => {
    expect(parseBlastMetadata('{"a":1}')).toEqual({ a: 1 });
    expect(parseBlastMetadata('')).toEqual({});
    expect(parseBlastMetadata(null)).toEqual({});
    expect(parseBlastMetadata('[1,2]')).toEqual({});
    expect(parseBlastMetadata('nope')).toEqual({});
  });
});

// The reason this exists: steps used to write the whole blob, so one step's
// save could erase keys another step owned (the text Message step dropped the
// remembered send time whenever an image was added).
describe('mergeBlastMetadata', () => {
  it('keeps keys the patch does not mention', () => {
    const stored = JSON.stringify({ templateSlug: 't1', schedule: { mode: 'later' }, multiChannel: true });
    expect(JSON.parse(mergeBlastMetadata(stored, { audienceConfirmed: true }))).toEqual({
      templateSlug: 't1',
      schedule: { mode: 'later' },
      multiChannel: true,
      audienceConfirmed: true,
    });
  });

  it('removes a key set to null and ignores undefined', () => {
    const stored = JSON.stringify({ templateSlug: 't1', utm: { enabled: true } });
    expect(JSON.parse(mergeBlastMetadata(stored, { templateSlug: null, utm: undefined }))).toEqual({
      utm: { enabled: true },
    });
  });

  it('starts from empty when the stored blob is unreadable', () => {
    expect(JSON.parse(mergeBlastMetadata('garbage', { a: 1 }))).toEqual({ a: 1 });
  });
});

describe('readMetadataPatch', () => {
  it('accepts only a plain object', () => {
    expect(readMetadataPatch({ a: 1 })).toEqual({ a: 1 });
    expect(readMetadataPatch([1])).toBeNull();
    expect(readMetadataPatch('{"a":1}')).toBeNull();
    expect(readMetadataPatch(null)).toBeNull();
  });
});

describe('readTemplateSlug / readLinkedSmsId', () => {
  it('reads the keys when present', () => {
    const raw = JSON.stringify({ templateSlug: 'spring', linkedSmsBlastId: 's1' });
    expect(readTemplateSlug(raw)).toBe('spring');
    expect(readLinkedSmsId(raw)).toBe('s1');
  });

  it('is empty otherwise', () => {
    expect(readTemplateSlug('{}')).toBe('');
    expect(readTemplateSlug(JSON.stringify({ templateSlug: 4 }))).toBe('');
    expect(readLinkedSmsId('{}')).toBeNull();
  });
});
