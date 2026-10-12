import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from '@/lib/email/render';
import type { EmailTemplate } from '@/lib/email/types';
import { htmlToText } from './html-to-text';
import {
  applyPreviewText,
  PREHEADER_MAX_LENGTH,
  PREHEADER_SPACER_UNIT,
  truncatePreheader,
} from './preheader';

function template(preheader: string): EmailTemplate {
  return {
    version: 2,
    subject: 'Fall Service',
    preheader,
    settings: { contentWidth: 600, contentBg: '#ffffff', bodyBg: '#f4f4f4', fontFamily: 'Arial', textColor: '#111111' },
    blocks: [{ id: 'a', type: 'text', props: { text: 'Body copy' } }],
  } as unknown as EmailTemplate;
}

/** The visible text of every hidden preheader block, in order. */
function preheaders(html: string): string[] {
  return [...html.matchAll(/data-skip-in-text="true"[^>]*>([^<]*)/g)].map((m) => m[1]);
}

describe('applyPreviewText', () => {
  // The bug: the blast's preview text was injected as a SECOND hidden block
  // after <body> while the template's own preheader stayed, so the inbox
  // snippet read "<blast preview> <template preheader>".
  it("replaces the template's react-email preheader instead of adding a second", async () => {
    const html = await renderEmailTemplate(template('Template preheader'));
    const out = applyPreviewText(html, 'Blast preview text');
    expect(preheaders(out)).toEqual(['Blast preview text']);
    expect(out).not.toContain('Template preheader');
  });

  it('escapes the preview text', async () => {
    const html = await renderEmailTemplate(template('x'));
    const out = applyPreviewText(html, `Tom & Jerry's <big> "sale"`);
    expect(preheaders(out)).toEqual(['Tom &amp; Jerry&#39;s &lt;big&gt; &quot;sale&quot;']);
  });

  it('pads a short preview so the snippet does not pull in body text', async () => {
    const html = await renderEmailTemplate(template('x'));
    const out = applyPreviewText(html, 'Short');
    expect(out).toContain(PREHEADER_SPACER_UNIT.repeat(PREHEADER_MAX_LENGTH - 'Short'.length));
  });

  it('injects one at the top of the body when the template has none', () => {
    const out = applyPreviewText('<html><body class="x"><p>Hi</p></body></html>', 'Preview');
    expect(out.startsWith('<html><body class="x"><div style="display:none;')).toBe(true);
    expect(preheaders(out)).toEqual(['Preview']);
  });

  it('prepends to a fragment with no <body>', () => {
    expect(preheaders(applyPreviewText('<p>Hi</p>', 'Preview'))).toEqual(['Preview']);
  });

  it("replaces a hand-built HTML template's class=\"preheader\" block", () => {
    const out = applyPreviewText(
      '<body><span class="preheader" style="display:none">Old snippet</span><p>Hi</p></body>',
      'New snippet',
    );
    expect(out).toContain('<span class="preheader" style="display:none">New snippet');
    expect(out).not.toContain('Old snippet');
  });

  it('leaves the template alone when the blast has no preview text', async () => {
    const html = await renderEmailTemplate(template('Template preheader'));
    expect(applyPreviewText(html, '')).toBe(html);
    expect(applyPreviewText(html, '   ')).toBe(html);
    expect(applyPreviewText(html, null)).toBe(html);
  });

  it('keeps merge tags in the preview text resolvable', () => {
    const out = applyPreviewText('<body></body>', 'Hi {{contact.first_name | default: "there"}}');
    expect(out).toContain('Hi {{contact.first_name | default: &quot;there&quot;}}');
  });

  it('never leaks into the text part', async () => {
    const html = await renderEmailTemplate(template('Template preheader'));
    expect(htmlToText(applyPreviewText(html, 'Blast preview text'))).toBe('Body copy');
  });
});

describe('truncatePreheader', () => {
  it('leaves short text alone', () => {
    expect(truncatePreheader('Hello')).toBe('Hello');
  });

  it('cuts before a merge tag that would straddle the limit', () => {
    const text = `${'a'.repeat(140)} {{contact.first_name}} more`;
    const cut = truncatePreheader(text);
    expect(cut).toBe('a'.repeat(140));
    expect(cut).not.toContain('{{');
  });

  it('keeps a merge tag that fits entirely', () => {
    const text = `${'a'.repeat(100)} {{contact.first_name}} ${'b'.repeat(60)}`;
    expect(truncatePreheader(text)).toContain('{{contact.first_name}}');
  });

  it('never splits an emoji', () => {
    const text = `${'a'.repeat(149)}\u{1f697}tail`;
    const cut = truncatePreheader(text);
    expect(cut).toBe('a'.repeat(149));
    expect(/[\u{d800}-\u{dfff}]/u.test(cut)).toBe(false);
  });

  // Rendered through the real Document: react-email's own substring(0, 150)
  // used to land mid-tag and ship `{{contact.fir` to the inbox.
  it('stops react-email from splitting a tag in a long preheader', async () => {
    const preheader = `${'Save big this weekend on every service. '.repeat(3).slice(0, 135)}{{contact.first_name}} and more`;
    const html = await renderEmailTemplate(template(preheader));
    const [rendered] = preheaders(html);
    expect(rendered).not.toMatch(/\{\{[^}]*$/);
  });
});
