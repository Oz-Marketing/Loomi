import { describe, expect, it } from 'vitest';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
  findUnknownMergetags,
  listMergetags,
} from './blast-mergetags';

const UNSUB = '[%unsubscribe_url%]';

function ctx(overrides?: {
  contact?: Parameters<typeof buildBlastMergetagContext>[0]['contact'];
  account?: Parameters<typeof buildBlastMergetagContext>[0]['account'];
}) {
  return buildBlastMergetagContext({
    contact: overrides?.contact ?? {
      firstName: 'Dana',
      lastName: 'Reyes',
      email: 'dana@example.com',
      city: 'Layton',
      vehicleMake: 'Audi',
      vehicleModel: 'Q5',
      lastServiceDate: new Date('2026-03-04T18:30:00.000Z'),
      customFields: { loyalty_tier: 'gold', visits: 4 },
    },
    account: overrides?.account ?? {
      dealer: 'Audi Layton',
      senderEmail: 'marketing@audilayton.com',
      city: 'Layton',
      state: 'UT',
    },
    unsubscribeToken: UNSUB,
  });
}

describe('buildBlastMergetagContext', () => {
  it('exposes the dotted namespace the template editor advertises', () => {
    const c = ctx();
    expect(c['contact.first_name']).toBe('Dana');
    expect(c['contact.full_name']).toBe('Dana Reyes');
    expect(c['location.name']).toBe('Audi Layton');
    expect(c['unsubscribe_link']).toBe(UNSUB);
  });

  it('derives full_name when the column is empty', () => {
    const c = ctx({ contact: { firstName: 'Sam', lastName: 'Vance' } });
    expect(c['contact.full_name']).toBe('Sam Vance');
  });

  it('renders dates as ISO day strings', () => {
    expect(ctx()['contact.last_service_date']).toBe('2026-03-04');
  });

  it('namespaces custom fields and stringifies non-strings', () => {
    const c = ctx();
    expect(c['custom_values.loyalty_tier']).toBe('gold');
    expect(c['custom_values.visits']).toBe('4');
  });

  it('yields empty strings, never undefined, for absent contact data', () => {
    const c = buildBlastMergetagContext({
      contact: null,
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(c['contact.first_name']).toBe('');
    expect(c['location.name']).toBe('');
  });
});

describe('applyBlastMergetags', () => {
  it('substitutes known tags', () => {
    const out = applyBlastMergetags('Hi {{contact.first_name}}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi Dana!');
  });

  it('tolerates inner whitespace', () => {
    const out = applyBlastMergetags('Hi {{  contact.first_name  }}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi Dana!');
  });

  it('resolves a KNOWN but empty tag to nothing rather than leaving braces', () => {
    const out = applyBlastMergetags(
      'Hi {{contact.first_name}}!',
      buildBlastMergetagContext({
        contact: { firstName: null },
        account: null,
        unsubscribeToken: UNSUB,
      }),
      { escape: true },
    );
    expect(out).toBe('Hi !');
  });

  it('leaves an UNKNOWN tag intact so a typo stays visible', () => {
    const out = applyBlastMergetags('Hi {{contact.frist_name}}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi {{contact.frist_name}}!');
  });

  // This is the whole point of the module: the editor offers
  // {{unsubscribe_link}} as a link target, and it has to become a real URL.
  it('turns {{unsubscribe_link}} into the SendGrid substitution tag', () => {
    const out = applyBlastMergetags(
      '<a href="{{unsubscribe_link}}">Unsubscribe</a>',
      ctx(),
      { escape: true },
    );
    expect(out).toBe(`<a href="${UNSUB}">Unsubscribe</a>`);
  });

  it('escapes HTML in substituted values but not in the template', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: `Tim & "Bud" <O'Neil>` },
      account: null,
      unsubscribeToken: UNSUB,
    });
    const out = applyBlastMergetags('<p>Hi {{contact.first_name}}</p>', c, {
      escape: true,
    });
    expect(out).toBe(
      '<p>Hi Tim &amp; &quot;Bud&quot; &lt;O&#39;Neil&gt;</p>',
    );
  });

  it('does not escape for the text/plain part', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: 'Tim & Bud' },
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('Hi {{contact.first_name}}', c, { escape: false }))
      .toBe('Hi Tim & Bud');
  });

  it('returns empty string for empty input', () => {
    expect(applyBlastMergetags('', ctx(), { escape: true })).toBe('');
  });

  it('ignores single-brace text', () => {
    expect(applyBlastMergetags('{contact.first_name}', ctx(), { escape: true }))
      .toBe('{contact.first_name}');
  });
});

describe('findUnknownMergetags', () => {
  it('reports only the tags that would ship literally', () => {
    const found = findUnknownMergetags(
      'Hi {{contact.first_name}}, your {{vehicle_make}} at {{location.name}}',
      ctx(),
    );
    expect(found).toEqual(['vehicle_make']);
  });

  it('dedupes repeats', () => {
    expect(findUnknownMergetags('{{nope}} {{nope}}', ctx())).toEqual(['nope']);
  });

  it('finds nothing in a fully valid body', () => {
    expect(
      findUnknownMergetags('{{contact.first_name}} {{unsubscribe_link}}', ctx()),
    ).toEqual([]);
  });
});

describe('listMergetags', () => {
  it('lists every referenced tag', () => {
    expect(
      listMergetags('{{contact.first_name}} and {{location.name}}').sort(),
    ).toEqual(['contact.first_name', 'location.name']);
  });
});
