import { describe, it, expect } from 'vitest';
import { buildAdfXml, parseVehicleContext, type AdfLeadInput, type VehicleContext } from './adf';

function makeInput(
  data: Record<string, unknown>,
  metadata: Record<string, string> | null = null,
  extra: Partial<AdfLeadInput> = {},
): AdfLeadInput {
  return {
    dealerName: 'Test Dealer',
    formName: 'Trade-In Appraisal',
    submission: {
      id: 'cmt24mhh500bzfbtsp7mvvelq',
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
    ...extra,
  } as AdfLeadInput;
}

function vehicle(xml: string): string {
  return xml.match(/<vehicle[\s\S]*?<\/vehicle>/)?.[0] ?? '';
}

function contactBlock(xml: string): string {
  return xml.match(/<contact>([\s\S]*?)<\/contact>/)?.[1] ?? '';
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

describe('buildAdfXml — customer name', () => {
  it('splits a single "Name" field into first and last', () => {
    // Regression: a form with one combined name field used to emit no
    // <name> at all, so Tekion showed the lead as an email address.
    const body = contactBlock(buildAdfXml(makeInput({ Name: 'Blake Glass' })));
    expect(body).toContain('<name part="first" type="individual">Blake</name>');
    expect(body).toContain('<name part="last" type="individual">Glass</name>');
  });

  it('keeps every token after the first as the last name', () => {
    const body = contactBlock(buildAdfXml(makeInput({ full_name: 'Mary Jo Van Der Berg' })));
    expect(body).toContain('>Mary</name>');
    expect(body).toContain('>Jo Van Der Berg</name>');
  });

  it('sends a mononym as a first name with no last', () => {
    const body = contactBlock(buildAdfXml(makeInput({ name: 'Cher' })));
    expect(body).toContain('>Cher</name>');
    expect(body).not.toContain('part="last"');
  });

  it('prefers an explicit first/last pair over a combined field', () => {
    const body = contactBlock(
      buildAdfXml(makeInput({ first_name: 'Ada', last_name: 'Lovelace', name: 'Wrong Person' })),
    );
    expect(body).toContain('>Ada</name>');
    expect(body).toContain('>Lovelace</name>');
    expect(body).not.toContain('Wrong');
  });

  it('never reads a non-person "name" field as the customer', () => {
    const body = contactBlock(buildAdfXml(makeInput({ business_name: 'Young Ford of Morgan' })));
    expect(body).not.toContain('<name');
  });
});

describe('buildAdfXml — vehicle', () => {
  const TRADE = { 'Vehicle Year': '2020', 'Vehicle Make': 'Ford', 'Vehicle Model': 'F-150' };

  it('emits nothing when the form has not opted in', () => {
    // Guessing wrong is worse than omitting — an unset form sends no
    // <vehicle> even though the fields are right there.
    expect(vehicle(buildAdfXml(makeInput(TRADE)))).toBe('');
  });

  it('marks a trade form as interest="trade-in"', () => {
    const block = vehicle(buildAdfXml(makeInput(TRADE, null, { vehicleContext: 'trade' })));
    expect(block).toContain('interest="trade-in"');
    expect(block).toContain('<year>2020</year>');
    expect(block).toContain('<make>Ford</make>');
    expect(block).toContain('<model>F-150</model>');
  });

  it('marks a shopping form as interest="buy"', () => {
    const block = vehicle(buildAdfXml(makeInput(TRADE, null, { vehicleContext: 'interest' })));
    expect(block).toContain('interest="buy"');
  });

  it('maps VIN, stock, trim and odometer', () => {
    const block = vehicle(
      buildAdfXml(
        makeInput(
          {
            vehicle_make: 'Ford',
            vehicle_vin: '1FTFW1E895FA12345',
            stock_number: '25N0033',
            trim_level: 'XLT',
            mileage: '85,000',
          },
          null,
          { vehicleContext: 'trade' },
        ),
      ),
    );
    expect(block).toContain('<vin>1FTFW1E895FA12345</vin>');
    expect(block).toContain('<stock>25N0033</stock>');
    expect(block).toContain('<trim>XLT</trim>');
    expect(block).toContain('<odometer units="mi">85000</odometer>');
  });

  it('reads "Model Year" as the year, not the model', () => {
    const block = vehicle(
      buildAdfXml(
        makeInput({ 'Model Year': '2020', Make: 'Ford' }, null, { vehicleContext: 'trade' }),
      ),
    );
    expect(block).toContain('<year>2020</year>');
    expect(block).not.toContain('<model>');
  });

  it('ignores a year-shaped question that is not a model year', () => {
    const block = vehicle(
      buildAdfXml(
        makeInput(
          { 'How many years have you owned it': '3', Make: 'Ford', Model: 'F-150' },
          null,
          { vehicleContext: 'trade' },
        ),
      ),
    );
    expect(block).not.toContain('<year>');
    expect(block).toContain('<make>Ford</make>');
  });

  it('skips the block when only a year came through', () => {
    // A bare year is noise on a CRM lead.
    const block = vehicle(
      buildAdfXml(makeInput({ 'Vehicle Year': '2020' }, null, { vehicleContext: 'trade' })),
    );
    expect(block).toBe('');
  });

  it('fills an interest vehicle from the host VDP meta params', () => {
    const block = vehicle(
      buildAdfXml(
        makeInput({}, { vin: '1N4BL4CW0TN325199', year: '2026', make: 'Nissan', model: 'Altima' }, {
          vehicleContext: 'interest',
        }),
      ),
    );
    expect(block).toContain('<vin>1N4BL4CW0TN325199</vin>');
    expect(block).toContain('<make>Nissan</make>');
  });

  it('never lets the VDP vehicle become the customer trade', () => {
    // The car on the page belongs to the dealer. Merging it into a trade
    // appraisal would put the wrong VIN on the lead.
    const block = vehicle(
      buildAdfXml(
        makeInput(TRADE, { vin: '1N4BL4CW0TN325199', make: 'Nissan' }, {
          vehicleContext: 'trade',
        }),
      ),
    );
    expect(block).not.toContain('1N4BL4CW0TN325199');
    expect(block).toContain('<make>Ford</make>');
  });

  it('places <vehicle> before <customer>, per the ADF child order', () => {
    const xml = buildAdfXml(makeInput(TRADE, null, { vehicleContext: 'trade' }));
    expect(xml.indexOf('<vehicle')).toBeLessThan(xml.indexOf('<customer>'));
    expect(xml.indexOf('<requestdate>')).toBeLessThan(xml.indexOf('<vehicle'));
  });

  it('escapes vehicle values', () => {
    const xml = buildAdfXml(
      makeInput({ make: 'Ford & Sons <script>' }, null, { vehicleContext: 'trade' }),
    );
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('<make>Ford &amp; Sons &lt;script&gt;</make>');
  });
});

describe('parseVehicleContext', () => {
  it('accepts the known values and rejects everything else', () => {
    expect(parseVehicleContext('interest')).toBe('interest');
    expect(parseVehicleContext('trade')).toBe('trade');
    expect(parseVehicleContext(null)).toBeNull();
    expect(parseVehicleContext('')).toBeNull();
    expect(parseVehicleContext('buy' as VehicleContext)).toBeNull();
  });
});

describe('buildAdfXml — attribution', () => {
  it('keeps <service> as the bare form name — Tekion groups Sub Source on it', () => {
    // The campaign deliberately stays out: a per-campaign Sub Source would
    // grow a new value every month and fragment the dealer's reporting.
    // It still reaches them in the comments block.
    const xml = buildAdfXml({
      ...makeInput({ name: 'Blake Glass' }),
      submission: {
        ...makeInput({ name: 'Blake Glass' }).submission,
        utmCampaign: 'yfm-trade-1000-aug-2026',
      },
    } as AdfLeadInput);
    expect(xml).toContain('<service>Trade-In Appraisal</service>');
    expect(comments(xml)).toContain('utm_campaign=yfm-trade-1000-aug-2026');
  });

  it('carries the submission id so the CRM can dedupe a retried send', () => {
    expect(buildAdfXml(makeInput({ name: 'Blake Glass' }))).toContain(
      '<id sequence="1" source="Loomi - Oz">cmt24mhh500bzfbtsp7mvvelq</id>',
    );
  });
});

describe('buildAdfXml — the live Young Ford appraisal form', () => {
  // Field keys copied verbatim off a real Tekion lead, so the heuristics
  // are pinned to the naming this form actually uses rather than to the
  // tidy names a test would otherwise invent.
  const LIVE_FIELDS = {
    name: 'Jason Barker',
    email: 'jbarker22@gmail.com',
    phone: '8015542232',
    'consent-1': 'true',
    'consent-2': 'true',
    'vehicle-make': 'Ford',
    'vehicle-year': '2020',
    'vehicle-model': 'F-150',
  };

  it('maps the whole lead into structured ADF fields', () => {
    const xml = buildAdfXml(makeInput(LIVE_FIELDS, null, { vehicleContext: 'trade' }));
    const who = contactBlock(xml);
    expect(who).toContain('<name part="first" type="individual">Jason</name>');
    expect(who).toContain('<name part="last" type="individual">Barker</name>');
    expect(who).toContain('<email>jbarker22@gmail.com</email>');
    expect(who).toContain('<phone type="voice">8015542232</phone>');

    const car = vehicle(xml);
    expect(car).toContain('interest="trade-in"');
    expect(car).toContain('<year>2020</year>');
    expect(car).toContain('<make>Ford</make>');
    expect(car).toContain('<model>F-150</model>');
  });

  it('keeps the consent checkboxes out of the vehicle', () => {
    const car = vehicle(buildAdfXml(makeInput(LIVE_FIELDS, null, { vehicleContext: 'trade' })));
    expect(car).not.toContain('true');
  });

  it('still forwards every field in the comments block', () => {
    // The dealer reads these in Tekion's Customer Comment panel; mapping
    // fields into <vehicle> must not remove them from the text dump.
    const body = comments(buildAdfXml(makeInput(LIVE_FIELDS, null, { vehicleContext: 'trade' })));
    for (const key of Object.keys(LIVE_FIELDS)) expect(body).toContain(`${key}: `);
  });
});
