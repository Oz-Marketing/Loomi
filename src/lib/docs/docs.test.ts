import { describe, expect, it } from 'vitest';

import { parseDoc } from './frontmatter';
import { renderMarkdown } from './markdown';
import {
  canReadDoc,
  groupDocs,
  searchDocs,
  type DocArticleSummary,
  type DocSector,
} from './types';

// ── Frontmatter ────────────────────────────────────────────────────────────

const VALID = `---
title: Audiences, Lists & Segments
summary: Building the list a campaign sends to.
sector: studio
category: Audiences
audience: everyone
order: 20
covers:
  - src/app/contacts/**
  - src/lib/segments/**
---

# Overview

Body text.
`;

describe('parseDoc', () => {
  it('reads scalars, lists, and the body', () => {
    const result = parseDoc(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.title).toBe('Audiences, Lists & Segments');
    expect(result.sector).toBe('studio');
    expect(result.order).toBe(20);
    expect(result.covers).toEqual(['src/app/contacts/**', 'src/lib/segments/**']);
    expect(result.body.startsWith('# Overview')).toBe(true);
  });

  it('keeps a colon inside a title', () => {
    const result = parseDoc(
      '---\ntitle: "Pacing: how the daily target moves"\nsummary: s\nsector: projects\ncategory: Pacing\n---\n\nBody.',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.title).toBe('Pacing: how the daily target moves');
  });

  it('fails loudly on a missing title, an unknown sector, or no frontmatter', () => {
    expect(parseDoc('---\nsummary: s\nsector: studio\ncategory: c\n---\n\nBody.').ok).toBe(false);
    expect(parseDoc('---\ntitle: t\nsummary: s\nsector: nope\ncategory: c\n---\n\nB.').ok).toBe(false);
    expect(parseDoc('# Just a heading\n\nBody.').ok).toBe(false);
  });

  it('falls back to staff on an unrecognized audience', () => {
    // The closed direction: a typo must not publish an internal article to
    // clients.
    const result = parseDoc(
      '---\ntitle: t\nsummary: s\nsector: agency\ncategory: c\naudience: evryone\n---\n\nB.',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audience).toBe('staff');
  });

  it('defaults order so an article with none sorts last, not first', () => {
    const result = parseDoc('---\ntitle: t\nsummary: s\nsector: agency\ncategory: c\n---\n\nB.');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toBe(999);
  });
});

// ── Markdown ───────────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  it('escapes HTML rather than passing it through', () => {
    const { html } = renderMarkdown('A <script>alert(1)</script> tag.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a javascript: link but keeps its text', () => {
    const { html } = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('keeps http, root-relative, and anchor links', () => {
    const { html } = renderMarkdown('[a](https://x.test) [b](/docs/x) [c](#top)');
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain('href="/docs/x"');
    expect(html).toContain('href="#top"');
  });

  it('starts body headings at h2 and collects the top level for the rail', () => {
    const { html, headings } = renderMarkdown('# One\n\ntext\n\n## Two\n\ntext');
    expect(html).toContain('<h2 id="one">');
    expect(html).toContain('<h3 id="two">');
    expect(headings).toEqual([{ id: 'one', text: 'One' }]);
  });

  it('dedupes repeated heading anchors', () => {
    const { html } = renderMarkdown('# Setup\n\na\n\n# Setup\n\nb');
    expect(html).toContain('id="setup"');
    expect(html).toContain('id="setup-2"');
  });

  it('leaves emphasis inside a code span alone', () => {
    const { html } = renderMarkdown('Use `a **b** c` here.');
    expect(html).toContain('<code>a **b** c</code>');
    expect(html).not.toContain('<strong>b</strong>');
  });

  it('renders a GFM table inside a scroll wrapper', () => {
    const { html } = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('doc-table-wrap');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('absorbs a wrapped list item rather than orphaning the second line', () => {
    // The articles are hard-wrapped, so nearly every list item spans two source
    // lines. Splitting them produced a bullet followed by a stray paragraph.
    const { html } = renderMarkdown('- **Click every link.** A campaign linking\n  to last month\u2019s page.\n- Next item');
    expect(html).toContain('<li><strong>Click every link.</strong> A campaign linking to last month\u2019s page.</li>');
    expect(html).not.toContain('<p>to last month');
  });

  it('still ends a list at a heading with no blank line before it', () => {
    const { html } = renderMarkdown('- one\n# Heading');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<h2 id="heading">');
  });

  it('nests a sub-list inside its parent item', () => {
    const { html } = renderMarkdown('- one\n  - nested\n- two');
    expect(html).toContain('<li>one<ul><li>nested</li></ul></li>');
    expect(html).toContain('<li>two</li>');
  });

  it('renders a callout, including block content inside it', () => {
    const { html } = renderMarkdown(':::warning\nDo not do this.\n\n- reason\n:::');
    expect(html).toContain('doc-callout-warning');
    expect(html).toContain('Watch out');
    expect(html).toContain('<li>reason</li>');
  });

  it('does not treat a fenced block as markdown', () => {
    const { html } = renderMarkdown('```\n# not a heading\n```');
    expect(html).toContain('<pre><code># not a heading</code></pre>');
    expect(html).not.toContain('<h2');
  });
});

// ── Visibility ─────────────────────────────────────────────────────────────

describe('canReadDoc', () => {
  const staff = { isClient: false, sectors: [] as never[] };
  const client: { isClient: boolean; sectors: DocSector[] } = {
    isClient: true,
    sectors: ['reporting'],
  };

  it('shows staff everything, including drafts and staff-only articles', () => {
    expect(canReadDoc({ audience: 'staff', sector: 'agency', status: 'draft' }, staff)).toBe(true);
  });

  it('never shows a client a staff article, whatever their sectors', () => {
    expect(
      canReadDoc({ audience: 'staff', sector: 'reporting', status: 'published' }, { ...client }),
    ).toBe(false);
  });

  it('never shows a client a draft', () => {
    expect(
      canReadDoc({ audience: 'everyone', sector: 'reporting', status: 'draft' }, { ...client }),
    ).toBe(false);
  });

  it('narrows a client to the sectors they can enter', () => {
    expect(
      canReadDoc({ audience: 'everyone', sector: 'reporting', status: 'published' }, { ...client }),
    ).toBe(true);
    expect(
      canReadDoc({ audience: 'everyone', sector: 'studio', status: 'published' }, { ...client }),
    ).toBe(false);
  });

  it('gives any client with a sector the shared platform articles', () => {
    expect(
      canReadDoc({ audience: 'everyone', sector: 'platform', status: 'published' }, { ...client }),
    ).toBe(true);
    expect(
      canReadDoc(
        { audience: 'everyone', sector: 'platform', status: 'published' },
        { isClient: true, sectors: [] },
      ),
    ).toBe(false);
  });
});

// ── Grouping and search ────────────────────────────────────────────────────

function article(over: Partial<DocArticleSummary>): DocArticleSummary {
  return {
    id: over.slug ?? 'id',
    slug: 'slug',
    title: 'Title',
    summary: 'Summary',
    sector: 'studio',
    category: 'Audiences',
    audience: 'everyone',
    status: 'published',
    order: 0,
    covers: [],
    needsReview: false,
    reviewNote: null,
    reviewedAt: null,
    sourceKey: null,
    editedInApp: false,
    updatedBy: null,
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

describe('groupDocs', () => {
  it('orders sectors by the registry and articles by `order`, not alphabetically', () => {
    const groups = groupDocs([
      article({ slug: 'b', sector: 'studio', title: 'Zebra', order: 1 }),
      article({ slug: 'a', sector: 'platform', category: 'Basics', title: 'Accounts' }),
      article({ slug: 'c', sector: 'studio', title: 'Apple', order: 2 }),
    ]);

    expect(groups.map((g) => g.sector)).toEqual(['platform', 'studio']);
    expect(groups[1].categories[0].articles.map((a) => a.title)).toEqual(['Zebra', 'Apple']);
  });

  it('drops sectors with no articles', () => {
    const groups = groupDocs([article({ slug: 'a' })]);
    expect(groups).toHaveLength(1);
  });
});

describe('searchDocs', () => {
  const all = [
    article({ slug: 'segments', title: 'Segments', summary: 'Filter contacts.' }),
    article({ slug: 'blasts', title: 'Email blasts', summary: 'Send to a segment.' }),
  ];

  it('ranks a title match above a summary match', () => {
    expect(searchDocs(all, 'segment').map((a) => a.slug)).toEqual(['segments', 'blasts']);
  });

  it('requires every term to land somewhere', () => {
    expect(searchDocs(all, 'segment banana')).toEqual([]);
  });

  it('returns everything for an empty query', () => {
    expect(searchDocs(all, '   ')).toHaveLength(2);
  });
});
