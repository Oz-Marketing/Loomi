import { describe, it, expect } from 'vitest';
import { parseChangelogFromPrBody } from './changelog-pr';

describe('parseChangelogFromPrBody', () => {
  it('parses a complete block', () => {
    const body = `
## What changed
Some implementation notes nobody outside the team cares about.

## Changelog
type: feature
audience: everyone
title: Bulk download in the Asset Library

Select any number of assets and download them as one zip.
Large selections stream as they build.
`;
    expect(parseChangelogFromPrBody(body)).toEqual([
      {
        type: 'feature',
        audience: 'everyone',
        title: 'Bulk download in the Asset Library',
        content:
          'Select any number of assets and download them as one zip.\nLarge selections stream as they build.',
      },
    ]);
  });

  it('stops at the next heading', () => {
    const body = `## Changelog
title: A thing

The body.

## Testing
Ran it locally. This must not end up in the entry.`;
    const [entry] = parseChangelogFromPrBody(body);
    expect(entry.content).toBe('The body.');
  });

  it('defaults type and audience', () => {
    const [entry] = parseChangelogFromPrBody('## Changelog\ntitle: T\n\nBody.');
    expect(entry.type).toBe('improvement');
    expect(entry.audience).toBe('everyone');
  });

  it('falls back to defaults for unrecognized values rather than dropping the entry', () => {
    const body = '## Changelog\ntype: breaking\naudience: martians\ntitle: T\n\nBody.';
    const [entry] = parseChangelogFromPrBody(body);
    expect(entry.type).toBe('improvement');
    expect(entry.audience).toBe('everyone');
  });

  it('honors staff-only audience', () => {
    const body = '## Changelog\naudience: staff\ntitle: Internal thing\n\nBody.';
    expect(parseChangelogFromPrBody(body)[0].audience).toBe('staff');
  });

  it('splits multiple entries on ---', () => {
    const body = `## Changelog
type: feature
title: First

Body one.

---
type: fix
title: Second

Body two.`;
    const entries = parseChangelogFromPrBody(body);
    expect(entries.map((e) => e.title)).toEqual(['First', 'Second']);
    expect(entries.map((e) => e.type)).toEqual(['feature', 'fix']);
  });

  // The PR template carries its instructions — and a filled-in example — inside
  // an HTML comment. Parsing that would file a fake entry on every merge.
  it('ignores a block inside an HTML comment', () => {
    const body = `<!--
## Changelog
title: Example from the template

Example body.
-->

## What changed
Real description.`;
    expect(parseChangelogFromPrBody(body)).toEqual([]);
  });

  it('returns nothing when there is no block', () => {
    expect(parseChangelogFromPrBody('Just a normal PR description.')).toEqual([]);
    expect(parseChangelogFromPrBody('')).toEqual([]);
    expect(parseChangelogFromPrBody(null)).toEqual([]);
  });

  it('skips a half-filled block instead of creating an empty entry', () => {
    expect(parseChangelogFromPrBody('## Changelog\ntitle: No body follows')).toEqual([]);
    expect(parseChangelogFromPrBody('## Changelog\n\nBody with no title.')).toEqual([]);
    expect(parseChangelogFromPrBody('## Changelog\n\n')).toEqual([]);
  });

  it('accepts any heading level and a trailing colon', () => {
    expect(parseChangelogFromPrBody('# Changelog\ntitle: T\n\nB.')).toHaveLength(1);
    expect(parseChangelogFromPrBody('### changelog:\ntitle: T\n\nB.')).toHaveLength(1);
  });

  it('tolerates CRLF line endings from the GitHub web editor', () => {
    const body = '## Changelog\r\ntype: fix\r\ntitle: T\r\n\r\nBody line.';
    expect(parseChangelogFromPrBody(body)).toEqual([
      { type: 'fix', audience: 'everyone', title: 'T', content: 'Body line.' },
    ]);
  });
});
