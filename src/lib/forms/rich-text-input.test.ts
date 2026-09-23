import { describe, it, expect } from 'vitest';
import { normalizeLinkUrl } from './editor/LinkDialog';

describe('normalizeLinkUrl', () => {
  it('keeps web, mailto and tel links as typed', () => {
    expect(normalizeLinkUrl('https://ex.com/privacy')).toBe('https://ex.com/privacy');
    expect(normalizeLinkUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeLinkUrl('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('treats a bare domain as https', () => {
    expect(normalizeLinkUrl(' youngautomotive.com/sms-terms ')).toBe('https://youngautomotive.com/sms-terms');
  });

  it('refuses unsafe schemes and empty input', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,x')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
  });
});
