import { describe, expect, it } from 'vitest';
import { readHtmlTemplateTitle, writeHtmlTemplateTitle } from './html-template-title';

const WITH_TITLE = `---
title: "Young mazda idaho falls conquest trade october 2026"
---

<!DOCTYPE html>
<html><body>title: not this one</body></html>`;

describe('readHtmlTemplateTitle', () => {
  it('reads a quoted frontmatter title', () => {
    expect(readHtmlTemplateTitle(WITH_TITLE)).toBe(
      'Young mazda idaho falls conquest trade october 2026',
    );
  });

  it('is undefined without a frontmatter block', () => {
    expect(readHtmlTemplateTitle('<!DOCTYPE html><html></html>')).toBeUndefined();
  });

  it('is undefined for a blank title', () => {
    expect(readHtmlTemplateTitle('---\ntitle: ""\n---\n<html></html>')).toBeUndefined();
  });
});

describe('writeHtmlTemplateTitle', () => {
  it('rewrites the title line and leaves the body alone', () => {
    const next = writeHtmlTemplateTitle(WITH_TITLE, 'October Conquest');
    expect(next).not.toBeNull();
    expect(readHtmlTemplateTitle(next!)).toBe('October Conquest');
    expect(next).toContain('<html><body>title: not this one</body></html>');
  });

  it('adds a title line to a block that lacks one', () => {
    const next = writeHtmlTemplateTitle('---\npreheader: Hi\n---\n<html></html>', 'Named');
    expect(readHtmlTemplateTitle(next!)).toBe('Named');
    expect(next).toContain('preheader: Hi');
  });

  it('survives quotes and replacement patterns in the name', () => {
    const name = 'Dealer\'s "$500" $& trade';
    const next = writeHtmlTemplateTitle(WITH_TITLE, name);
    expect(readHtmlTemplateTitle(next!)).toBe(name);
  });

  it('refuses to invent a block for plain HTML', () => {
    expect(writeHtmlTemplateTitle('<!DOCTYPE html><html></html>', 'X')).toBeNull();
  });
});
