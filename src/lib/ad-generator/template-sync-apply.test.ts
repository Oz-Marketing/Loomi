import { describe, it, expect, vi } from 'vitest';

// The module under test reaches for the database and S3 at import time through
// its own imports. Only the pure policy helpers are exercised here, so the
// clients are stubbed rather than stood up.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/s3', () => ({
  isS3Configured: () => false,
  buildS3Key: () => '',
  s3PublicUrl: () => '',
  uploadToS3: async () => undefined,
}));

import type { TemplateDoc } from './doc-types';
import {
  summarizeApplyResults,
  syncRenderSizeIds,
  type ApplyResult,
} from './template-sync-apply';

/** A doc whose sizes span portrait, square and two banners. */
function doc(sizes: TemplateDoc['sizes']): TemplateDoc {
  return {
    id: 't1',
    name: 'Test',
    sizes,
    fields: [],
    elements: [],
    layouts: {},
    defaults: {},
  } as TemplateDoc;
}

const SIZES: TemplateDoc['sizes'] = [
  { id: 'story', label: 'Story', width: 1080, height: 1920 },
  { id: 'leader', label: 'Leaderboard', width: 728, height: 90 },
  { id: 'square', label: 'Square', width: 1080, height: 1080 },
  { id: 'feed', label: 'Feed', width: 1200, height: 628 },
];

describe('syncRenderSizeIds', () => {
  /**
   * The whole 504 fix. Rendering every size turned one template edit into
   * thousands of Chromium screenshots; if this ever regresses to the full list
   * the feature stops working again, and it stops working in production only.
   */
  it('renders ONE size by default, not every size the doc defines', () => {
    expect(syncRenderSizeIds(doc(SIZES))).toEqual(['square']);
  });

  it('picks the squarest size, wherever it sits in the list', () => {
    // Square is third above, so a "first size" implementation would pass the
    // test above by accident.
    const noSquare = doc([
      { id: 'leader', label: 'Leaderboard', width: 728, height: 90 },
      { id: 'feed', label: 'Feed', width: 1200, height: 628 },
    ]);
    expect(syncRenderSizeIds(noSquare)).toEqual(['feed']);
  });

  it('honors an explicit size list', () => {
    expect(syncRenderSizeIds(doc(SIZES), ['leader', 'feed'])).toEqual(['leader', 'feed']);
  });

  it('keeps only sizes the design actually has', () => {
    expect(syncRenderSizeIds(doc(SIZES), ['feed', 'nope'])).toEqual(['feed']);
  });

  it('falls back to the preview size when the caller names nothing the doc has', () => {
    // A misconfiguration must not silently render zero sizes, which would report
    // the ad as updated with no thumbnail behind it.
    expect(syncRenderSizeIds(doc(SIZES), ['nope'])).toEqual(['square']);
  });

  it('returns undefined for a doc with no sizes', () => {
    expect(syncRenderSizeIds(doc([]))).toBeUndefined();
  });
});

describe('summarizeApplyResults', () => {
  const result = (outcome: ApplyResult['outcome']): ApplyResult => ({
    creativeId: `c-${outcome}-${Math.random()}`,
    name: 'Ad',
    outcome,
  });

  it('counts each outcome', () => {
    expect(
      summarizeApplyResults([result('updated'), result('updated'), result('blocked'), result('failed')]),
    ).toEqual({ updated: 2, blocked: 1, failed: 1, skipped: 0 });
  });

  it('folds unchanged and detached together as skipped', () => {
    // Both mean "we left this ad exactly as it was", which is all a tally needs.
    expect(summarizeApplyResults([result('unchanged'), result('skipped_detached')])).toEqual({
      updated: 0,
      blocked: 0,
      failed: 0,
      skipped: 2,
    });
  });

  it('accounts for every result, so the dialog can never lose an ad', () => {
    const results = [
      result('updated'),
      result('blocked'),
      result('failed'),
      result('unchanged'),
      result('skipped_detached'),
    ];
    const t = summarizeApplyResults(results);
    expect(t.updated + t.blocked + t.failed + t.skipped).toBe(results.length);
  });

  it('is empty for an empty run', () => {
    expect(summarizeApplyResults([])).toEqual({ updated: 0, blocked: 0, failed: 0, skipped: 0 });
  });
});
