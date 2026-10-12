import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from '@/lib/email/render';
import type { EmailTemplate } from '@/lib/email/types';
import { htmlToText } from './html-to-text';

// The zero-width padding react-email puts after every preheader. Built from
// code points so no invisible character sits in this file.
const ZERO_WIDTH = /[\u{200b}-\u{200f}\u{feff}\u{ad}\u{2060}]/u;

describe('htmlToText — what the old stripper got wrong', () => {
  it('drops the head, title, styles and scripts', () => {
    const text = htmlToText(
      '<!DOCTYPE html><html><head><title>Fall Service Event</title><style>.a{color:red}</style>'
      + '<script>var x = 1 < 2;</script></head><body><p>Hello</p></body></html>',
    );
    expect(text).toBe('Hello');
  });

  it('drops the hidden preheader and its zero-width padding', () => {
    const text = htmlToText(
      '<body><div style="display:none;max-height:0" data-skip-in-text="true">Preview copy'
      + `<div>${'\u{a0}\u{200c}\u{200b}\u{200d}\u{200e}\u{200f}\u{feff}'.repeat(100)}</div></div>`
      + '<p>Body copy</p></body>',
    );
    expect(text).toBe('Body copy');
    expect(ZERO_WIDTH.test(text)).toBe(false);
  });

  it('drops display:none blocks and class="preheader" spans', () => {
    expect(
      htmlToText('<span class="preheader">Sneak peek</span><div style="display: none !important">x</div><p>Shown</p>'),
    ).toBe('Shown');
  });

  it('drops Outlook conditional comments, keeping the non-Outlook branch', () => {
    const text = htmlToText(
      '<!--[if mso]><v:roundrect href="https://x.com"><i>&#8202;&#8202;</i>Outlook button</v:roundrect><![endif]-->'
      + '<!--[if !mso]><!--><a href="https://x.com">Everyone else</a><!--<![endif]-->',
    );
    expect(text).toBe('Everyone else (https://x.com)');
  });

  it('decodes entities instead of printing them', () => {
    expect(htmlToText('<p>It&#x27;s Bob&#39;s &amp; Sons&nbsp;&mdash;&#8202;today &copy; 2026</p>')).toBe(
      "It's Bob's & Sons \u{2014} today \u{a9} 2026",
    );
  });

  it('removes invisible characters but keeps emoji sequences whole', () => {
    const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}';
    expect(htmlToText(`<p>Fam\u{200b}ily ${family} day\u{feff}</p>`)).toBe(`Family ${family} day`);
  });
});

describe('htmlToText — structure', () => {
  it('turns blocks into lines and paragraphs into blank-line breaks', () => {
    expect(htmlToText('<h1>Fall Sale</h1><p>First line<br>second line</p><p>Next</p><div>A</div><div>B</div>'))
      .toBe('Fall Sale\n\nFirst line\nsecond line\n\nNext\n\nA\nB');
  });

  it('collapses formatting whitespace', () => {
    expect(htmlToText('<p>\n   Lots    of\n\n   space   </p>')).toBe('Lots of space');
  });

  it('lists items', () => {
    expect(htmlToText('<ul><li>Oil change</li><li>Tire rotation</li></ul>')).toBe('- Oil change\n- Tire rotation');
  });

  it('separates layout table cells', () => {
    expect(htmlToText('<table><tr><td>Left</td><td>Right</td></tr></table>')).toBe('Left\nRight');
  });
});

describe('htmlToText — links and images', () => {
  it('keeps the URL as "text (url)"', () => {
    expect(htmlToText('<a href="https://dealer.com/service?a=1&amp;b=2">Book service</a>')).toBe(
      'Book service (https://dealer.com/service?a=1&b=2)',
    );
  });

  it('prints a link whose text is its URL once', () => {
    expect(htmlToText('<a href="https://www.dealer.com/">dealer.com</a>')).toBe('dealer.com');
  });

  it('shows the address for mailto and skips a phone link that already shows its number', () => {
    expect(htmlToText('<a href="mailto:sales@dealer.com?subject=Hi">Email us</a>')).toBe('Email us (sales@dealer.com)');
    expect(htmlToText('<a href="tel:+18015550100">(801) 555-0100</a>')).toBe('(801) 555-0100');
  });

  it('drops dead and in-page links but keeps their text', () => {
    expect(htmlToText('<a href="#">Click here</a> <a href="#top">Top</a>')).toBe('Click here Top');
  });

  it('keeps the unsubscribe token and merge tags intact', () => {
    expect(htmlToText('<a href="[%unsubscribe_url%]">Unsubscribe</a>')).toBe('Unsubscribe ([%unsubscribe_url%])');
    expect(
      htmlToText('<a href="{{unsubscribe_link}}">Opt out</a> <p>Hi {{contact.first_name | default: &quot;there&quot;}}</p>'),
    ).toBe('Opt out ({{unsubscribe_link}})\n\nHi {{contact.first_name | default: "there"}}');
  });

  it('uses image alt text, including as a link label', () => {
    expect(htmlToText('<img src="a.png" alt="Fall Sale"><a href="https://x.com"><img src="b.png" alt="Shop now"></a>'))
      .toBe('Fall Sale Shop now (https://x.com)');
  });

  it('ignores tracking pixels and images without alt text', () => {
    expect(htmlToText('<p>Hi<img src="p.gif" width="1" height="1" alt="pixel"><img src="x.png"></p>')).toBe('Hi');
  });

  it('prints the bare URL for a link with no text at all', () => {
    expect(htmlToText('<a href="https://x.com/"><img src="x.png"></a>')).toBe('https://x.com/');
  });
});

describe('htmlToText — a real react-email render', () => {
  it('produces readable text from a Loomi template', async () => {
    const template = {
      version: 2,
      subject: 'Fall Service {{contact.first_name}}',
      preheader: "It's time & more",
      settings: { contentWidth: 600, contentBg: '#ffffff', bodyBg: '#f4f4f4', fontFamily: 'Arial', textColor: '#111111' },
      blocks: [
        { id: 'a', type: 'text', props: { text: "Hello {{contact.first_name | default: \"there\"}}, it's time." } },
        { id: 'b', type: 'button', props: { text: 'Book now', url: 'https://dealer.com/?make=Honda&model=Accord' } },
      ],
    } as unknown as EmailTemplate;
    const html = await renderEmailTemplate(template);
    const text = htmlToText(html);

    expect(text).toBe(
      'Hello {{contact.first_name | default: "there"}}, it\'s time.\n\n'
      + 'Book now (https://dealer.com/?make=Honda&model=Accord)',
    );
    expect(text).not.toContain('Fall Service');
    expect(text).not.toContain('time & more');
    expect(ZERO_WIDTH.test(text)).toBe(false);
  });
});

describe('htmlToText — robustness', () => {
  it('returns empty for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('survives unclosed tags, stray brackets and plain text', () => {
    expect(htmlToText('5 < 6 and <b>bold')).toBe('5 < 6 and bold');
    expect(htmlToText('just text')).toBe('just text');
  });
});
