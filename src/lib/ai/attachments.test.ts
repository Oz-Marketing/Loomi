import { describe, it, expect } from 'vitest';
import {
  attachmentBlocks,
  formatBytes,
  isImageType,
  toWire,
  type Attachment,
} from './attachments';

describe('isImageType', () => {
  it('accepts what the Messages API accepts and nothing else', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(isImageType(t), t).toBe(true);
    }
    // Rejected BEFORE upload rather than by the API: offering a format the
    // server will refuse is worse than never offering it.
    for (const t of ['image/svg+xml', 'image/heic', 'application/pdf', 'image/bmp']) {
      expect(isImageType(t), t).toBe(false);
    }
  });
});

describe('toWire', () => {
  const base: Attachment = { id: '1', kind: 'image', name: 'a.png', size: 10 };

  it('drops presentation-only fields', () => {
    const wire = toWire({ ...base, data: 'AAA', mediaType: 'image/png' });
    expect(wire).toEqual({ kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'AAA' });
  });

  it('refuses an incomplete attachment rather than sending a broken block', () => {
    expect(toWire({ ...base, mediaType: 'image/png' })).toBeNull();
    expect(toWire({ ...base, kind: 'text' })).toBeNull();
  });

  it('keeps an empty text file, which is a fact worth sending', () => {
    expect(toWire({ id: '2', kind: 'text', name: 'empty.txt', size: 0, text: '' })).toEqual({
      kind: 'text',
      name: 'empty.txt',
      text: '',
    });
  });
});

describe('attachmentBlocks', () => {
  it('emits an image block plus a naming line, so the model can refer to it', () => {
    const blocks = attachmentBlocks([
      { kind: 'image', name: 'ad.png', mediaType: 'image/png', data: 'B64' },
    ]);
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'B64' } },
      { type: 'text', text: '(attached image: ad.png)' },
    ]);
  });

  it('labels a text file with its name', () => {
    const blocks = attachmentBlocks([{ kind: 'text', name: 'rows.csv', text: 'a,b\n1,2' }]);
    expect(blocks).toEqual([
      { type: 'text', text: '--- attached file: rows.csv ---\na,b\n1,2' },
    ]);
  });

  it('preserves order across mixed attachments', () => {
    const blocks = attachmentBlocks([
      { kind: 'text', name: 'one.txt', text: 'x' },
      { kind: 'image', name: 'two.png', mediaType: 'image/png', data: 'B' },
    ]);
    expect((blocks[0] as { text: string }).text).toContain('one.txt');
    expect((blocks[1] as { type: string }).type).toBe('image');
  });
});

describe('formatBytes', () => {
  it('reads as a person would write it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
  });
});
