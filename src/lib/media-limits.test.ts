import { describe, it, expect } from 'vitest';
import {
  DIRECT_UPLOAD_MAX_BYTES,
  checkAnyUploadSize,
  checkUploadSize,
  formatBytes,
  needsDirectUpload,
  uploadLimitFor,
} from './media-limits';

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

describe('needsDirectUpload', () => {
  it('keeps normal files on the buffered path, which is what gives us dedupe', () => {
    expect(needsDirectUpload(40 * MB, 'image/jpeg')).toBe(false);
    expect(needsDirectUpload(150 * MB, 'video/mp4')).toBe(false);
  });

  it('sends anything over its family ceiling direct', () => {
    expect(needsDirectUpload(80 * MB, 'image/jpeg')).toBe(true);
    expect(needsDirectUpload(900 * MB, 'video/mp4')).toBe(true);
  });

  it('uses the family limit, not one flat number', () => {
    // 120 MB is over the image ceiling but under the design-file one, so a PSD
    // stays buffered where a JPEG of the same size goes direct.
    expect(needsDirectUpload(120 * MB, 'image/jpeg')).toBe(true);
    expect(needsDirectUpload(120 * MB, 'image/vnd.adobe.photoshop')).toBe(false);
  });
});

describe('checkAnyUploadSize', () => {
  it('accepts anything a direct upload could carry', () => {
    // A 2 GB video is refused by the buffered check and allowed by this one —
    // that difference is the whole point of the direct path.
    expect(checkUploadSize(2 * 1024 * MB, 'video/mp4')).not.toBeNull();
    expect(checkAnyUploadSize(2 * 1024 * MB)).toBeNull();
  });

  it('refuses past S3’s single-PUT limit', () => {
    expect(checkAnyUploadSize(DIRECT_UPLOAD_MAX_BYTES)).toBeNull();
    const err = checkAnyUploadSize(DIRECT_UPLOAD_MAX_BYTES + 1);
    expect(err).toContain('5 GB');
  });
});
