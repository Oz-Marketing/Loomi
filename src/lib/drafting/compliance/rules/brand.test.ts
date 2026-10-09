import { describe, expect, it } from 'vitest';
import { asAccount, blockById, draft } from '../__fixtures__/drafts';
import {
  dealerLogoRule,
  dealerNameRule,
  noFooterLogoRule,
  noSerifRule,
  siteUrlRule,
  yagHelveticaRule,
} from './brand';

describe('fonts.no-serif', () => {
  it('rejects a serif base font', async () => {
    const a = await draft((t) => {
      t.settings.fontFamily = 'Georgia, "Times New Roman", serif';
    });
    expect(noSerifRule.check(a)[0]).toMatchObject({ severity: 'error', where: 'settings' });
  });

  it('rejects a serif on one block, and a serif fallback', async () => {
    const a = await draft((t) => {
      blockById(t, 'headline').props.fontFamily = 'Playfair Display';
      blockById(t, 'body').props.fontFamily = 'Arial, serif';
    });
    expect(noSerifRule.check(a).map((f) => f.where)).toEqual(['block:headline', 'block:body']);
  });
});

describe('fonts.yag-helvetica', () => {
  it('requires Helvetica to lead the base stack', async () => {
    const a = await draft((t) => {
      t.settings.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    });
    expect(yagHelveticaRule.check(a)[0].message).toContain('"-apple-system"');
  });
});

describe('footer logo', () => {
  it('requires the dealer logo for most makes', async () => {
    const a = await draft((t) => {
      const footer = blockById(t, 'footer');
      footer.children = footer.children!.filter((b) => b.id !== 'footer-logo');
    });
    expect(dealerLogoRule.check(a)).toMatchObject([{ severity: 'error', where: 'footer' }]);
  });

  it('forbids it for Hyundai, Audi and Volkswagen', async () => {
    const a = asAccount(await draft(), { oems: ['Hyundai'] });
    expect(noFooterLogoRule.check(a)[0].message).toBe('Hyundai emails carry no logo in the footer. Remove it.');
  });
});

describe('footer.site-url', () => {
  it('needs the camelCase site on file', async () => {
    const a = asAccount(await draft(), { siteDisplay: null });
    expect(siteUrlRule.check(a)[0].message).toContain('no footer site name on file');
  });

  it('rejects an all-lowercase site name', async () => {
    const a = asAccount(await draft(), { siteDisplay: 'youngchev.com' });
    const messages = siteUrlRule.check(a).map((f) => f.message);
    expect(messages).toContain('"youngchev.com" isn\'t a camelCase site name like YoungCDJRRiverdale.com.');
  });

  it('requires the footer to show it', async () => {
    const a = await draft((t) => {
      blockById(t, 'footer-text').props.text = 'youngchev.com';
    });
    expect(siteUrlRule.check(a).map((f) => f.message)).toEqual(['The footer doesn\'t show the site as "YoungChev.com".']);
  });

  it('only warns when the display domain differs from the website on file', async () => {
    // Young CDJR of Riverdale's website is youngchryslerdodgejeepramriverdale.com.
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'footer-text').props.text = 'YoungCDJRRiverdale.com';
      }),
      { siteDisplay: 'YoungCDJRRiverdale.com', website: 'https://youngchryslerdodgejeepramriverdale.com/' },
    );
    expect(siteUrlRule.check(a)).toMatchObject([{ severity: 'warning' }]);
  });
});

describe('copy.dealer-name-in-full', () => {
  const RIVERDALE = {
    key: 'youngChryslerDodgeJeepRamOfRiverdale',
    dealer: 'Young Chrysler Dodge Jeep Ram of Riverdale',
    oems: ['Dodge', 'Fiat', 'Chrysler', 'Jeep', 'Ram'],
    siteDisplay: 'YoungCDJRRiverdale.com',
  };

  it('catches "Young CDJR of Riverdale", as sent in the 2026-09 Ram HD subject', async () => {
    const a = asAccount(
      await draft(undefined, {
        subjects: [
          { kind: 'initial', text: '23% off Ram HDs at Young CDJR of Riverdale' },
          { kind: 'urgent', text: 'Last chance: 23% off Ram HDs at Young Chrysler Dodge Jeep Ram of Riverdale' },
        ],
      }),
      RIVERDALE,
    );
    expect(dealerNameRule.check(a)).toMatchObject([
      { severity: 'error', where: 'subject 1 (initial)', message: expect.stringContaining('("CDJR")') },
    ]);
  });

  it('leaves the shorthand inside the camelCase site name alone', async () => {
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'footer-text').props.text = 'YoungCDJRRiverdale.com';
      }),
      RIVERDALE,
    );
    expect(dealerNameRule.check(a)).toEqual([]);
  });

  it('applies the account’s own known short forms', async () => {
    const a = asAccount(
      await draft(undefined, {
        subjects: [
          { kind: 'initial', text: 'Your Equinox at young chevy' },
          { kind: 'urgent', text: 'Last chance at Young Chevrolet' },
        ],
      }),
      { abbreviations: ['Young Chevy'] },
    );
    expect(dealerNameRule.check(a).map((f) => f.where)).toEqual(['subject 1 (initial)']);
  });
});
