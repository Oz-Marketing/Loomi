import { describe, it, expect } from 'vitest';
import {
  clipFilter,
  clipFitFilter,
  clipOpacityFilter,
  even,
  hasRoundedCorners,
  isMotionMime,
  isMotionUrl,
  motionKind,
  motionSettings,
  roundedMaskSvg,
  MOTION_DEFAULTS,
} from './motion';

describe('motionKind', () => {
  it('classifies video containers', () => {
    expect(motionKind('https://cdn/x/hero.mp4')).toBe('video');
    expect(motionKind('https://cdn/x/hero.WEBM')).toBe('video');
    expect(motionKind('/media/clip.mov')).toBe('video');
    expect(motionKind('/media/clip.m4v')).toBe('video');
  });

  it('classifies a GIF as motion but keeps it distinct from video', () => {
    // The distinction matters: a GIF stays an <img> in the DOM, so promoting it
    // to a <video> would change how existing textures render.
    expect(motionKind('/media/loop.gif')).toBe('gif');
  });

  it('leaves stills alone', () => {
    for (const url of ['/a.png', '/a.jpg', '/a.jpeg', '/a.webp', '/a.svg', '', undefined, null]) {
      expect(motionKind(url)).toBeNull();
    }
  });

  it('ignores query strings and fragments, so a signed URL still classifies', () => {
    expect(motionKind('https://s3/x/hero.mp4?X-Amz-Signature=abc&x=.png')).toBe('video');
    expect(isMotionUrl('https://s3/x/still.png?v=hero.mp4')).toBe(false);
  });

  it('reads a data: URI by its declared type', () => {
    expect(motionKind('data:video/mp4;base64,AAAA')).toBe('video');
    expect(motionKind('data:image/gif;base64,AAAA')).toBe('gif');
    expect(motionKind('data:image/png;base64,AAAA')).toBeNull();
  });

  it('accepts video and gif mime types on the upload side', () => {
    expect(isMotionMime('video/quicktime')).toBe(true);
    expect(isMotionMime('image/gif')).toBe(true);
    expect(isMotionMime('image/png')).toBe(false);
    expect(isMotionMime(null)).toBe(false);
  });
});

describe('motionSettings', () => {
  it('falls back to the defaults', () => {
    expect(motionSettings(undefined)).toEqual({ ...MOTION_DEFAULTS });
    expect(motionSettings({ motion: {} })).toEqual({ ...MOTION_DEFAULTS });
  });

  it('clamps a duration that would pin the render box', () => {
    expect(motionSettings({ motion: { durationSec: 600 } }).durationSec).toBe(30);
    expect(motionSettings({ motion: { durationSec: 0 } }).durationSec).toBe(1);
  });

  it('clamps and rounds fps', () => {
    expect(motionSettings({ motion: { fps: 240 } }).fps).toBe(60);
    expect(motionSettings({ motion: { fps: 2 } }).fps).toBe(12);
    expect(motionSettings({ motion: { fps: 29.7 } }).fps).toBe(30);
  });

  it('lets an export-time override win over the doc', () => {
    expect(motionSettings({ motion: { durationSec: 6 } }, { durationSec: 10 }).durationSec).toBe(10);
  });

  it('ignores junk instead of emitting NaN into the filtergraph', () => {
    expect(motionSettings({ motion: { durationSec: NaN, fps: undefined } })).toEqual({ ...MOTION_DEFAULTS });
  });
});

describe('even', () => {
  it('rounds to an even number — h264 refuses odd dimensions', () => {
    expect(even(1081)).toBe(1082);
    expect(even(627)).toBe(628);
    expect(even(0)).toBe(2);
  });
});

describe('clipFilter', () => {
  const base = { x: 0, y: 0, w: 1080, h: 1080, fps: 30 } as const;

  it('covers by scaling up and cropping on the focal point', () => {
    const f = clipFilter({ ...base, fit: 'cover', focalX: 0.25, focalY: 0.75 });
    expect(f).toContain('scale=w=1080:h=1080:force_original_aspect_ratio=increase');
    expect(f).toContain('crop=1080:1080:(in_w-out_w)*0.2500:(in_h-out_h)*0.7500');
    expect(f).toContain('fps=30');
  });

  it('defaults the focal point to centre', () => {
    expect(clipFilter({ ...base, fit: 'cover' })).toContain('(in_w-out_w)*0.5000');
  });

  it('applies crop zoom by scaling past the box before cropping', () => {
    const f = clipFilter({ ...base, fit: 'cover', zoom: 1.5 });
    expect(f).toContain('scale=w=1620:h=1620:force_original_aspect_ratio=increase');
    expect(f).toContain('crop=1080:1080:');
  });

  it('ignores a zoom below 1 rather than shrinking the clip', () => {
    expect(clipFilter({ ...base, fit: 'cover', zoom: 0.5 })).toContain('scale=w=1080:h=1080');
  });

  it('letterboxes a contain fit with TRANSPARENT bars, not black ones', () => {
    const f = clipFilter({ ...base, fit: 'contain' });
    expect(f).toContain('force_original_aspect_ratio=decrease');
    expect(f).toContain('pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black@0');
  });

  it('fills like cover when the element is set to tile (a video cannot tile)', () => {
    expect(clipFilter({ ...base, fit: 'tile' })).toContain('force_original_aspect_ratio=increase');
  });

  it('carries layer opacity into the alpha channel', () => {
    expect(clipFilter({ ...base, fit: 'cover', opacity: 40 })).toContain('colorchannelmixer=aa=0.4000');
    expect(clipFilter({ ...base, fit: 'cover', opacity: 100 })).not.toContain('colorchannelmixer');
  });

  it('normalises to even dimensions and starts the stream at zero', () => {
    const f = clipFilter({ ...base, w: 601, h: 337, fit: 'cover' });
    expect(f).toContain('scale=w=602:h=338');
    expect(f).toContain('setpts=PTS-STARTPTS');
  });
});

describe('rounded clips', () => {
  it('knows when a mask is needed at all', () => {
    expect(hasRoundedCorners(undefined)).toBe(false);
    expect(hasRoundedCorners([0, 0, 0, 0])).toBe(false);
    expect(hasRoundedCorners([0, 24, 0, 0])).toBe(true);
  });

  it('keeps opacity OUT of the fit chain, so it can be applied after masking', () => {
    // Order matters: colorchannelmixer scales alpha, so fading has to come after
    // the corner mask or the rounding is thrown away.
    expect(clipFitFilter({ x: 0, y: 0, w: 100, h: 100, fit: 'cover', fps: 30, opacity: 50 })).not.toContain('colorchannelmixer');
    expect(clipOpacityFilter(50)).toBe('colorchannelmixer=aa=0.5000');
    expect(clipOpacityFilter(100)).toBe('');
    expect(clipOpacityFilter(undefined)).toBe('');
  });

  it('draws the mask in BRIGHTNESS, not alpha', () => {
    // ffmpeg reads the mask's luma. A transparent-cornered PNG would flatten to
    // black and mask nothing.
    const svg = roundedMaskSvg(200, 100, [10, 10, 10, 10]);
    expect(svg).toContain('<rect width="200" height="100" fill="#000"/>');
    expect(svg).toContain('fill="#fff"');
  });

  it('clamps a corner to what the box can hold, like a browser does', () => {
    const svg = roundedMaskSvg(100, 60, [999, 0, 0, 0]);
    // Half the short edge is the ceiling: 30, not 999.
    expect(svg).toContain('A 30 30');
    expect(svg).not.toContain('999');
  });

  it('draws per-corner radii independently', () => {
    const svg = roundedMaskSvg(200, 200, [20, 0, 40, 0]);
    expect(svg).toContain('A 20 20');
    expect(svg).toContain('A 40 40');
  });
});
