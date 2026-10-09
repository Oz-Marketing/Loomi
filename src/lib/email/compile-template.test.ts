import { describe, expect, it } from 'vitest';
import { compileTemplateContent, stripFrontmatter } from './compile-template';
import { emptyTemplate } from './types';

const HTML = '<!DOCTYPE html>\n<html><body><p>Trade in this October</p></body></html>';

// The shape observed in prod on a Young Mazda of Idaho Falls template.
const WITH_FRONTMATTER = `---
title: "Young mazda idaho falls conquest trade october 2026"
---

${HTML}`;

describe('stripFrontmatter', () => {
  it('removes a leading frontmatter block and the blank line after it', () => {
    expect(stripFrontmatter(WITH_FRONTMATTER)).toBe(HTML);
  });

  it('handles CRLF line endings', () => {
    expect(stripFrontmatter(WITH_FRONTMATTER.replace(/\n/g, '\r\n'))).toBe(
      HTML.replace(/\n/g, '\r\n'),
    );
  });

  it('removes a multi-key block', () => {
    const raw = `---\ntitle: "A"\nsubject: "B"\npreheader: "C"\n---\n${HTML}`;
    expect(stripFrontmatter(raw)).toBe(HTML);
  });

  it('tolerates a BOM or leading whitespace before the block', () => {
    expect(stripFrontmatter(`﻿${WITH_FRONTMATTER}`)).toBe(HTML);
    expect(stripFrontmatter(`\n  ${WITH_FRONTMATTER}`)).toBe(HTML);
  });

  it('leaves content without a leading block untouched', () => {
    expect(stripFrontmatter(HTML)).toBe(HTML);
  });

  it('only strips the first block, never a later --- in the body', () => {
    const raw = `${WITH_FRONTMATTER}\n<p>---</p>\n---\nnot: frontmatter\n---\n`;
    expect(stripFrontmatter(raw)).toBe(`${HTML}\n<p>---</p>\n---\nnot: frontmatter\n---\n`);
  });

  it('ignores a --- that is not on a line of its own', () => {
    const raw = `---<p>divider</p>\n---\n${HTML}`;
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it('leaves an unterminated block alone rather than eating the email', () => {
    const raw = `---\ntitle: "A"\n${HTML}`;
    expect(stripFrontmatter(raw)).toBe(raw);
  });
});

describe('compileTemplateContent', () => {
  it('strips frontmatter from an HTML-only template', async () => {
    const html = await compileTemplateContent(WITH_FRONTMATTER);
    expect(html).toBe(HTML);
    expect(html).not.toContain('title:');
  });

  it('renders a v2 JSON template through react-email', async () => {
    const tpl = { ...emptyTemplate(), title: 'V2' };
    const html = await compileTemplateContent(JSON.stringify(tpl));
    expect(html).toMatch(/<html/i);
    expect(html).not.toContain('"version"');
  });
});
