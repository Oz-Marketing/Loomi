import { describe, it, expect } from 'vitest';
import { buildAdfXml, type AdfLeadInput } from './adf';

function makeInput(
  data: Record<string, unknown>,
  metadata: Record<string, string> | null = null,
): AdfLeadInput {
  return {
    dealerName: 'Test Dealer',
    formName: 'Trade-In Appraisal',
    submission: {
      data,
      metadata,
      createdAt: new Date('2026-07-28T00:00:00Z'),
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    },
    contact: null,
  } as AdfLeadInput;
}

function comments(xml: string): string {
  return xml.match(/<comments>([\s\S]*?)<\/comments>/)?.[1] ?? '';
}

const FILE = {
  url: 'https://cdn.example.com/form-uploads/acct/form1/uuid-title.pdf',
  name: 'title.pdf',
  size: 1234,
  type: 'application/pdf',
};

describe('buildAdfXml comments — uploaded files', () => {
  it('renders an uploaded file as "name (url)" so the URL survives', () => {
    const body = comments(buildAdfXml(makeInput({ trade_docs: [FILE] })));
    expect(body).toContain('trade_docs: title.pdf (');
    expect(body).toContain(FILE.url);
    // Regression: FileValue objects used to hit Array.prototype.join and
    // stringify to "[object Object]", silently dropping the file URL.
    expect(body).not.toContain('[object Object]');
  });

  it('renders multiple files as a comma-separated list', () => {
    const second = { ...FILE, url: 'https://cdn.example.com/b.png', name: 'photo.png' };
    const body = comments(buildAdfXml(makeInput({ trade_docs: [FILE, second] })));
    expect(body).toContain('title.pdf (');
    expect(body).toContain('photo.png (');
    expect(body).not.toContain('[object Object]');
  });

  it('leaves an unfilled optional file field empty', () => {
    const body = comments(buildAdfXml(makeInput({ trade_docs: [] })));
    expect(body).toContain('trade_docs: ');
    expect(body).not.toContain('[object Object]');
  });

  it('still renders plain string and checkbox-array values', () => {
    const body = comments(
      buildAdfXml(makeInput({ first_name: 'Ada', interests: ['sedan', 'suv'] })),
    );
    expect(body).toContain('first_name: Ada');
    expect(body).toContain('interests: sedan, suv');
  });
});

describe('buildAdfXml comments — embed metadata', () => {
  const META = {
    vin: '1N4BL4CW0TN325199',
    stock: '25N0033',
    page_url: 'https://www.youngnissanriverdale.com/new/Nissan/2026-Altima.htm',
  };

  it('carries the page context a salesperson needs onto the lead', () => {
    const body = comments(buildAdfXml(makeInput({ first_name: 'Ada' }, META)));
    expect(body).toContain('Page context:');
    expect(body).toContain('vin: 1N4BL4CW0TN325199');
    expect(body).toContain('stock: 25N0033');
    expect(body).toContain('page_url: https://www.youngnissanriverdale.com');
  });

  it('omits the section entirely when the form had no meta params', () => {
    const body = comments(buildAdfXml(makeInput({ first_name: 'Ada' })));
    expect(body).not.toContain('Page context:');
  });

  it('escapes metadata so a hostile host page cannot break the document', () => {
    const xml = buildAdfXml(
      makeInput({ first_name: 'Ada' }, { vin: '</comments><injected>&"\'' }),
    );
    // The raw payload never appears; the escaped form does. A CRM that
    // parses this sees one <comments> element, not an injected sibling.
    expect(xml).not.toContain('<injected>');
    expect(comments(xml)).toContain('&lt;/comments&gt;&lt;injected&gt;&amp;&quot;&apos;');
    expect(xml.match(/<comments>/g)).toHaveLength(1);
  });

  it('ignores a metadata column holding something other than a string map', () => {
    const body = comments(
      buildAdfXml(makeInput({ first_name: 'Ada' }, 'junk' as unknown as null)),
    );
    expect(body).not.toContain('Page context:');
  });
});
