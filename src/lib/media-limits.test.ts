import { describe, it, expect } from 'vitest';
import { checkUploadSize, formatBytes, uploadLimitFor } from './media-limits';

const MB = 1024 * 1024;

describe('uploadLimitFor', () => {
  it('gives images and video different ceilings', () => {
    // The whole point of the change: one flat cap made a PSD master unstorable.
    expect(uploadLimitFor('image/jpeg').bytes).toBe(50 * MB);
    expect(uploadLimitFor('video/mp4').bytes).toBe(200 * MB);
  });

  it('treats OEM template zips as design files', () => {
    // The Audi packages in §11 arrive as zips.
    expect(uploadLimitFor('application/zip').label).toBe('Design files and archives');
    expect(uploadLimitFor('image/vnd.adobe.photoshop').bytes).toBe(200 * MB);
  });

  it('matches on family, not exact type', () => {
    expect(uploadLimitFor('image/x-adobe-dng').bytes).toBe(50 * MB);
    expect(uploadLimitFor('video/quicktime').bytes).toBe(200 * MB);
  });

  it('falls back for unknown and missing types', () => {
    expect(uploadLimitFor('application/x-made-up').bytes).toBe(50 * MB);
    expect(uploadLimitFor(null).bytes).toBe(50 * MB);
    expect(uploadLimitFor(undefined).label).toBe('Files');
  });

  it('is case-insensitive', () => {
    expect(uploadLimitFor('IMAGE/PNG').bytes).toBe(50 * MB);
  });
});

describe('checkUploadSize', () => {
  it('passes a file inside its family limit', () => {
    expect(checkUploadSize(40 * MB, 'image/jpeg')).toBeNull();
    expect(checkUploadSize(150 * MB, 'video/mp4')).toBeNull();
  });

  it('accepts a file exactly at the limit', () => {
    expect(checkUploadSize(50 * MB, 'image/jpeg')).toBeNull();
  });

  it('names the family in the error so the limit is explicable', () => {
    const err = checkUploadSize(80 * MB, 'image/jpeg');
    expect(err).toContain('80 MB');
    expect(err).toContain('50 MB');
    expect(err).toContain('images');
  });

  it('lets a 120 MB PSD through where the old flat 25 MB cap refused it', () => {
    expect(checkUploadSize(120 * MB, 'image/vnd.adobe.photoshop')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('scales the unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(50 * MB)).toBe('50 MB');
    expect(formatBytes(1024 * MB)).toBe('1 GB');
  });
});
