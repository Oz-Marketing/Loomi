import { describe, it, expect } from 'vitest';
import { isPipelineSource } from './ingest';

describe('isPipelineSource', () => {
  // The bridge's batch label names the FEED, not a marketing source. It was
  // landing in Contact.source and rendering to clients as their biggest lead
  // source, ahead of CDK and Dealer Website.
  it('recognises the bridge labels', () => {
    expect(isPipelineSource('oz-reports')).toBe(true);
    expect(isPipelineSource('oz-reports:automotive')).toBe(true);
    expect(isPipelineSource('oz-reports:leads')).toBe(true);
    // A feed suffix nobody has added yet is covered by the prefix match.
    expect(isPipelineSource('oz-reports:something-new')).toBe(true);
    expect(isPipelineSource('  OZ-Reports:Automotive  ')).toBe(true);
  });

  it('leaves real marketing sources alone', () => {
    expect(isPipelineSource('AutoTrader')).toBe(false);
    expect(isPipelineSource('Dealer Website')).toBe(false);
    expect(isPipelineSource('CDK')).toBe(false);
    expect(isPipelineSource(null)).toBe(false);
    expect(isPipelineSource(undefined)).toBe(false);
    // Prefix boundary: a real source that merely starts with the same letters
    // must survive. `oz-reports` only matches at a colon or end-of-string.
    expect(isPipelineSource('Oz-Reports-Referral-Program')).toBe(false);
  });
});
