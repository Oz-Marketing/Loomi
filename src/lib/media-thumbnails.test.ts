import { describe, it, expect } from 'vitest';
import { shouldThumbnailOnFinalize, THUMBNAIL_SOURCE_MAX } from './media-thumbnails';

describe('shouldThumbnailOnFinalize', () => {
  it('thumbnails an ordinary image', () => {
    // The whole library falls here: median 0.13MB, max 5MB on production.
    expect(shouldThumbnailOnFinalize('image/png', 1_500_000)).toBe(true);
    expect(shouldThumbnailOnFinalize('image/jpeg', 5 * 1024 * 1024)).toBe(true);
  });

  it('refuses anything that is not a raster image', () => {
    // The direct-upload path exists so the app never holds a whole file in
    // memory; fetching a video back to thumbnail it would undo that.
    expect(shouldThumbnailOnFinalize('video/mp4', 1000)).toBe(false);
    expect(shouldThumbnailOnFinalize('application/pdf', 1000)).toBe(false);
  });

  it('refuses an image over the cap, at the boundary', () => {
    expect(shouldThumbnailOnFinalize('image/png', THUMBNAIL_SOURCE_MAX)).toBe(true);
    expect(shouldThumbnailOnFinalize('image/png', THUMBNAIL_SOURCE_MAX + 1)).toBe(false);
  });

  it('refuses a zero-byte object rather than trying to decode nothing', () => {
    expect(shouldThumbnailOnFinalize('image/png', 0)).toBe(false);
  });

  it('leaves headroom over the largest real asset', () => {
    // A cap that only just clears today's data starts skipping silently the
    // first time someone uploads a bigger photo.
    const largestObserved = 5.06 * 1024 * 1024;
    expect(THUMBNAIL_SOURCE_MAX).toBeGreaterThan(largestObserved * 4);
  });
});
