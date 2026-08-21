import { describe, it, expect } from 'vitest';
import { isVideoMime } from './media-video-thumbnail';

// The extraction itself needs ffmpeg and real bytes; it's exercised end to end
// against generated clips. What's worth pinning here is the gate — every caller
// runs it before spending anything, and getting it wrong either skips real videos
// or points ffmpeg at a PDF.
describe('isVideoMime', () => {
  it('accepts anything video/*, not a hand-kept container list', () => {
    for (const m of ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'VIDEO/MP4']) {
      expect(isVideoMime(m)).toBe(true);
    }
  });

  it('rejects stills, documents and absent types', () => {
    for (const m of ['image/png', 'image/gif', 'application/pdf', 'application/octet-stream', '', null, undefined]) {
      expect(isVideoMime(m)).toBe(false);
    }
  });
});
