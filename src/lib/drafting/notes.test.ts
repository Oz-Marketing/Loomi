import { describe, expect, it } from 'vitest';
import { cantDraftUpdate, draftReadyUpdate, escapeHtml } from './notes';
import type { CreativeReading } from './reading';

const READING: CreativeReading = {
  requestType: 'model_offer',
  fields: [
    { key: 'vehicle', label: 'Vehicle', value: '2026 Mazda CX-90', confidence: 'high' },
    { key: 'apr', label: 'APR', value: '1.9% for 72 months', confidence: 'low' },
    { key: 'expiration', label: 'Offer ends', value: '10/31/2026', confidence: 'high' },
  ],
  disclaimer: { text: 'APR for well-qualified buyers <720+ FICO> & approved credit.\nSee dealer.', confidence: 'high' },
  model: 'test',
  readAt: '2026-10-09T00:00:00.000Z',
};

describe('draftReadyUpdate', () => {
  const html = draftReadyUpdate({
    templateUrl: 'https://studio.loomilm.com/templates/editor?design=draft-x&a=1',
    versionNumber: 1,
    subjects: [
      { kind: 'initial', text: '1.9% APR on the new 2026 Mazda CX-90' },
      { kind: 'urgent', text: 'Last chance: 1.9% APR on the CX-90' },
    ],
    previews: [{ kind: 'initial', text: 'Finance the CX-90 at 1.9% APR for 72 months.' }],
    reading: READING,
    notes: ['Mazda co-op: the email never names Young Mazda of Missoula in full.'],
    warnings: [],
  });

  it('links the template and lists what was read, in order', () => {
    expect(html).toContain('<a href="https://studio.loomilm.com/templates/editor?design=draft-x&amp;a=1">Open the template in Loomi</a>');
    expect(html.indexOf('Vehicle: 2026 Mazda CX-90')).toBeLessThan(html.indexOf('APR: 1.9%'));
  });

  it('lists the subject and preview options, initial and urgent', () => {
    expect(html).toContain('<li>Initial: 1.9% APR on the new 2026 Mazda CX-90</li><li>Urgent: Last chance: 1.9% APR on the CX-90</li>');
    expect(html).toContain('<strong>Preview text</strong>');
  });

  it('flags only the low-confidence readings', () => {
    expect(html).toContain('APR: 1.9% for 72 months <strong>— low confidence');
    expect(html).not.toContain('Vehicle: 2026 Mazda CX-90 <strong>— low confidence');
  });

  it('carries the disclaimer verbatim, escaped so monday shows every character', () => {
    expect(html).toContain('APR for well-qualified buyers &lt;720+ FICO&gt; &amp; approved credit.<br>See dealer.');
  });

  it('says so when the creative carried no disclaimer, and lists notes', () => {
    const none = draftReadyUpdate({
      templateUrl: 'https://x',
      versionNumber: 2,
      subjects: [],
      previews: [],
      reading: { ...READING, disclaimer: null },
      notes: [],
      warnings: ['w'],
    });
    expect(none).toContain('(version 2)');
    expect(none).toContain('none read off the creative');
    expect(none).toContain('<strong>Warnings</strong>');
    expect(html).toContain('<li>Mazda co-op: the email never names Young Mazda of Missoula in full.</li>');
  });
});

describe('cantDraftUpdate', () => {
  it('escapes the reason', () => {
    expect(cantDraftUpdate('Design Assets has no PNG <found: a.psd>')).toContain('no PNG &lt;found: a.psd&gt;');
  });
  it('escapes quotes for attributes too', () => {
    expect(escapeHtml('"x"')).toBe('&quot;x&quot;');
  });
});
