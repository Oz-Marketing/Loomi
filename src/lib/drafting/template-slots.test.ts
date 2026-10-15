import { describe, expect, it } from 'vitest';
import type { EmailTemplate } from '@/lib/email/types';
import { parseDraftingFor, slotsIn, templateSlotProblems } from './template-slots';

const shell = (blocks: EmailTemplate['blocks']): EmailTemplate => ({
  version: '2',
  settings: { bodyBg: '#ffffff', contentBg: '#ffffff', contentWidth: 600, fontFamily: 'Helvetica, Arial, sans-serif', textColor: '#000000' },
  blocks,
});

describe('parseDraftingFor', () => {
  it('keeps only known request types', () => {
    expect(parseDraftingFor('["sales_event","nonsense","model_offer"]')).toEqual(['model_offer', 'sales_event']);
    expect(parseDraftingFor(null)).toEqual([]);
    expect(parseDraftingFor('not json')).toEqual([]);
  });
});

describe('slotsIn / templateSlotProblems', () => {
  it('finds slots only where they belong', () => {
    const t = shell([
      { id: 'a', type: 'image', props: { src: '{{draft.hero}}' } },
      { id: 'b', type: 'heading', props: { text: ' {{draft.headline}} ' } },
      { id: 'c', type: 'section', props: {}, children: [{ id: 'd', type: 'text', props: { text: '{{draft.body}}' } }] },
      { id: 'e', type: 'image', props: { src: '{{draft.body}}' } },
    ]);
    expect([...slotsIn(t)].sort()).toEqual(['body', 'headline', 'hero']);
    expect(templateSlotProblems(t)).toEqual([]);
  });

  it('requires the hero and the body, and only drag-and-drop templates', () => {
    expect(templateSlotProblems(shell([]))).toHaveLength(2);
    expect(templateSlotProblems(null)).toEqual(['Only drag-and-drop templates can be used for drafting.']);
  });
});
