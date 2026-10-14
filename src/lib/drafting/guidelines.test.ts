import { describe, expect, it } from 'vitest';
import { copyPrompt } from './copywriter';
import { coopNotes, documentsFor, pickPages, type GuidelineDoc } from './guidelines';

/** Titles as they are filed in AdGuidelineDoc. */
const FILED = [
  { make: 'CDJR', title: 'CDJR 2026 Guidelines' },
  { make: 'CDJR', title: 'CDJR Dealer Accelerate Co-Op Program 2026' },
  { make: 'Chevrolet', title: 'GM iMR Program Guidelines' },
  { make: 'GMC', title: 'GMC Brand Style Guide' },
  { make: 'Honda', title: 'Honda DMA Program Overview (Jan 2025)' },
  { make: 'Honda', title: 'Honda Powersports Co-op Guidelines 2025' },
  { make: 'Hyundai', title: 'Hyundai Co-op Claim Status Definitions' },
  { make: 'Hyundai', title: 'Hyundai Guidelines 2026' },
  { make: 'BRP', title: 'BRP (Can-Am, Ski-Doo, Sea-Doo, Lynx) Co-op Guidelines 2026' },
  { make: 'CFMOTO', title: 'CFMOTO Co-Op Guidelines (Oct 2025)' },
  { make: 'Subaru', title: 'Subaru SAF Guidelines 2026' },
];
const titles = (make: string) => documentsFor(make, FILED).map((d) => d.title);

describe('documentsFor', () => {
  it('finds the documents filed under another name', () => {
    expect(titles('Jeep')).toEqual(['CDJR 2026 Guidelines', 'CDJR Dealer Accelerate Co-Op Program 2026']);
    expect(titles('Buick')).toEqual(['GM iMR Program Guidelines']);
    expect(titles('GMC')).toEqual(['GM iMR Program Guidelines', 'GMC Brand Style Guide']);
    expect(titles('Ski-Doo')).toEqual(['BRP (Can-Am, Ski-Doo, Sea-Doo, Lynx) Co-op Guidelines 2026']);
  });

  it("tells Honda's car guide from its powersports guide", () => {
    expect(titles('Honda')).toEqual(['Honda DMA Program Overview (Jan 2025)']);
    expect(titles('Honda Powersports')).toEqual(['Honda Powersports Co-op Guidelines 2025']);
  });

  it('keeps a claims reference out, matches case-insensitively, and finds nothing for a make with no document', () => {
    expect(titles('Hyundai')).toEqual(['Hyundai Guidelines 2026']);
    expect(titles('CFMoto')).toEqual(['CFMOTO Co-Op Guidelines (Oct 2025)']);
    expect(titles('Nissan')).toEqual([]);
  });
});

const DOC: GuidelineDoc = {
  title: 'Subaru SAF Guidelines 2026',
  pages: [
    'Welcome to the program. Table of contents.',
    'Email advertising is ineligible for co-op except through CareConnect. Email subject lines may not state a price.',
    'An advertised price must show the official TSRP, labeled TSRP, with an itemized price calculation beside the offer.',
    'Billboards and print media sizes.',
  ],
};

describe('pickPages', () => {
  it('sends the pages that bear on an offer email, in page order, and never a page that scores nothing', () => {
    expect(pickPages([DOC]).map((p) => p.page)).toEqual([2, 3]);
  });

  it("puts a page about email as a channel first, and doesn't take an address in a running footer for one", () => {
    const footer = ' Phone: 1.866.717.2300 | Email: saf@ansira';
    const doc: GuidelineDoc = {
      title: 'Subaru SAF Guidelines 2026',
      pages: [
        `Advertised price, MSRP, APR, lease and financing offers must be required in every offer price payment.${footer}`,
        `Ineligible media: direct mail and email, except through CareConnect.${footer}`,
      ],
    };
    // Room for one page: the email-eligibility page wins over the denser pricing page.
    expect(pickPages([doc], doc.pages[1].length).map((p) => p.page)).toEqual([2]);
  });

  it('stays within its budget, keeping the most relevant page', () => {
    expect(pickPages([DOC], DOC.pages[1].length).map((p) => p.page)).toEqual([2]);
  });
});

describe('coopNotes', () => {
  it('cites a requirement whose quote is on the stated page', () => {
    const [note] = coopNotes(
      [{ requirement: 'Show the TSRP beside the price.', document: DOC.title, page: 3, quote: 'must show the official TSRP, labeled TSRP' }],
      [DOC],
    );
    expect(note).toBe('Co-op (Subaru SAF Guidelines 2026, p. 3): Show the TSRP beside the price. — "must show the official TSRP, labeled TSRP"');
  });

  it('cites the page the quote is really on when the stated page is wrong', () => {
    const [note] = coopNotes(
      [{ requirement: 'Show the TSRP.', document: DOC.title, page: 1, quote: 'must show the official TSRP, labeled TSRP' }],
      [DOC],
    );
    expect(note).toContain('p. 3)');
  });

  it("keeps a requirement whose quote can't be found, but says so instead of citing it", () => {
    const [note] = coopNotes(
      [{ requirement: 'Show the TSRP.', document: DOC.title, page: 3, quote: 'retailers receive quarterly bonus funds for every radio spot' }],
      [DOC],
    );
    expect(note).toContain("couldn't find the quoted words on p. 3");
  });
});

describe('copyPrompt', () => {
  it('gives the copywriter the guideline pages, labeled for citing', () => {
    const prompt = copyPrompt(
      {
        dealer: 'Young Subaru',
        oems: ['Subaru'],
        reading: { requestType: 'model_offer', fields: [], disclaimer: null, model: 'm', readAt: 'now' },
        facts: [],
        request: { project: null, details: '', audience: '', runDates: null },
        bannedPhrases: [],
        guidelines: pickPages([DOC]),
      },
      [],
    );
    expect(prompt).toContain('[Subaru SAF Guidelines 2026, page 3]');
    expect(prompt).not.toContain('Billboards');
  });
});
