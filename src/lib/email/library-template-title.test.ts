import { describe, expect, it } from 'vitest';
import { updateLibraryTemplateTitle } from './library-template-title';
import { emptyTemplate, isV2Template, parseV2Template } from './types';

const HTML = '<!DOCTYPE html><html><body>Hi</body></html>';

describe('updateLibraryTemplateTitle', () => {
  it('writes a v2 title into the JSON, keeping it a v2 template', () => {
    const raw = JSON.stringify({ ...emptyTemplate(), title: 'Old' }, null, 2);
    const next = updateLibraryTemplateTitle(raw, '  New name ');
    expect(isV2Template(next)).toBe(true);
    expect(next.startsWith('---')).toBe(false);
    expect(parseV2Template(next)?.title).toBe('New name');
  });

  it('adds a frontmatter block to HTML that has none', () => {
    expect(updateLibraryTemplateTitle(HTML, 'Conquest')).toBe(
      `---\ntitle: "Conquest"\n---\n\n${HTML}`,
    );
  });

  it('replaces an existing title line and keeps other keys', () => {
    const raw = `---\ntitle: "Old"\npreheader: "P"\n---\n${HTML}`;
    expect(updateLibraryTemplateTitle(raw, 'New')).toBe(
      `---\ntitle: "New"\npreheader: "P"\n---\n${HTML}`,
    );
  });
});
