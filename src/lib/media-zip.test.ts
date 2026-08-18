import { describe, it, expect } from 'vitest';
import {
  archiveFilename,
  compressionFor,
  planZipEntries,
  renditionFolder,
  uniqueName,
} from './media-zip';

describe('compressionFor', () => {
  it('stores formats that are already compressed', () => {
    // The point of the change: DEFLATE over a 2 GB MP4 spends real CPU to save
    // roughly nothing.
    expect(compressionFor('image/jpeg')).toBe('STORE');
    expect(compressionFor('image/png')).toBe('STORE');
    expect(compressionFor('video/mp4')).toBe('STORE');
    expect(compressionFor('application/zip')).toBe('STORE');
  });

  it('compresses a PSD even though its MIME type starts with image/', () => {
    // The trap: `image/vnd.adobe.photoshop` would be STOREd by any prefix rule
    // that treats images as pre-compressed, and a layered master compresses well.
    // Same cause as the PSD bug in media-limits.ts.
    expect(compressionFor('image/vnd.adobe.photoshop')).toBe('DEFLATE');
    expect(compressionFor('image/tiff')).toBe('DEFLATE');
    expect(compressionFor('image/svg+xml')).toBe('DEFLATE');
  });

  it('compresses text, fonts and unknown types', () => {
    expect(compressionFor('text/csv')).toBe('DEFLATE');
    expect(compressionFor('font/otf')).toBe('DEFLATE');
    expect(compressionFor('application/pdf')).toBe('DEFLATE');
    expect(compressionFor('application/x-made-up')).toBe('DEFLATE');
  });

  it('is case-insensitive and ignores charset parameters', () => {
    expect(compressionFor('IMAGE/JPEG')).toBe('STORE');
    expect(compressionFor('image/jpeg; charset=binary')).toBe('STORE');
  });

  it('falls back to compressing when the type is missing', () => {
    expect(compressionFor(null)).toBe('DEFLATE');
    expect(compressionFor(undefined)).toBe('DEFLATE');
  });
});

describe('uniqueName', () => {
  it('keeps two accounts’ logo.png apart', () => {
    const used = new Set<string>();
    expect(uniqueName(used, 'logo.png')).toBe('logo.png');
    expect(uniqueName(used, 'logo.png')).toBe('logo (2).png');
    expect(uniqueName(used, 'logo.png')).toBe('logo (3).png');
  });

  it('handles names with no extension', () => {
    const used = new Set<string>();
    uniqueName(used, 'README');
    expect(uniqueName(used, 'README')).toBe('README (2)');
  });

  it('does not collide with a name that already looks disambiguated', () => {
    const used = new Set<string>();
    uniqueName(used, 'a.jpg');
    uniqueName(used, 'a (2).jpg');
    expect(uniqueName(used, 'a.jpg')).toBe('a (3).jpg');
  });
});

describe('renditionFolder', () => {
  it('names the folder after the master', () => {
    expect(renditionFolder('Audi A4.jpg')).toBe('Audi A4 — sizes');
    expect(renditionFolder('master')).toBe('master — sizes');
  });
});

describe('planZipEntries', () => {
  const asset = (filename: string, mimeType: string, renditions?: { name: string; s3Key: string }[]) => ({
    filename,
    s3Key: `media/x/${filename}`,
    mimeType,
    renditions,
  });

  it('plans one entry per asset with its own compression', () => {
    const entries = planZipEntries(
      [asset('hero.jpg', 'image/jpeg'), asset('layout.psd', 'image/vnd.adobe.photoshop')],
      false,
    );
    expect(entries.map((e) => [e.name, e.compression])).toEqual([
      ['hero.jpg', 'STORE'],
      ['layout.psd', 'DEFLATE'],
    ]);
  });

  it('omits renditions unless asked', () => {
    const withSizes = asset('hero.jpg', 'image/jpeg', [{ name: '1x1', s3Key: 'media/x/r1' }]);
    expect(planZipEntries([withSizes], false)).toHaveLength(1);
    expect(planZipEntries([withSizes], true)).toHaveLength(2);
  });

  it('files renditions under a folder named for the master', () => {
    const entries = planZipEntries(
      [
        asset('Audi A4.jpg', 'image/jpeg', [
          { name: '1x1', s3Key: 'media/x/r1' },
          { name: '16x9', s3Key: 'media/x/r2' },
        ]),
      ],
      true,
    );
    expect(entries.map((e) => e.name)).toEqual([
      'Audi A4.jpg',
      'Audi A4 — sizes/1x1.jpg',
      'Audi A4 — sizes/16x9.jpg',
    ]);
  });

  it('de-duplicates across masters AND renditions in one namespace', () => {
    // Two rooftops each with logo.png, each with a 1x1 rendition: every entry
    // must be distinct or the archive extracts unpredictably.
    const one = asset('logo.png', 'image/png', [{ name: '1x1', s3Key: 'a' }]);
    const two = { ...asset('logo.png', 'image/png', [{ name: '1x1', s3Key: 'b' }]), s3Key: 'media/y/logo.png' };
    const names = planZipEntries([one, two], true).map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('logo (2).png');
  });

  it('keeps each entry pointed at its own object', () => {
    const entries = planZipEntries(
      [asset('hero.jpg', 'image/jpeg', [{ name: '1x1', s3Key: 'media/x/rendition-1' }])],
      true,
    );
    expect(entries[0].s3Key).toBe('media/x/hero.jpg');
    expect(entries[1].s3Key).toBe('media/x/rendition-1');
  });

  it('stores renditions, which are always JPEG', () => {
    const entries = planZipEntries(
      [asset('layout.psd', 'image/vnd.adobe.photoshop', [{ name: '1x1', s3Key: 'r' }])],
      true,
    );
    expect(entries[0].compression).toBe('DEFLATE');
    expect(entries[1].compression).toBe('STORE');
  });
});

describe('archiveFilename', () => {
  it('dates the archive so repeat downloads do not collide', () => {
    expect(archiveFilename(new Date('2026-08-13T12:00:00Z'))).toBe('loomi-media-2026-08-13.zip');
  });
});
