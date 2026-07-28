import { describe, it, expect } from 'vitest';
import { buildAdfXml, type AdfLeadInput } from './adf';

function makeInput(data: Record<string, unknown>): AdfLeadInput {
  return {
    dealerName: 'Test Dealer',
    formName: 'Trade-In Appraisal',
    submission: {
      data,
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
