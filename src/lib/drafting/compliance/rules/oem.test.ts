import { describe, expect, it } from 'vitest';
import { asAccount, blockById, draft } from '../__fixtures__/drafts';
import {
  hondaNameRule,
  hondaPaletteRule,
  kiaPaletteRule,
  mazdaExclusivityRule,
  vwBackgroundRule,
  vwSquareCtaRule,
} from './oem';

describe('oem.mazda.no-exclusivity', () => {
  it('blocks "exclusive" and flags phrasing that implies it', async () => {
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'body').props.text = 'An exclusive VIP offer: $3,500 off a 2026 Chevy Equinox ACTIV.';
      }),
      { oems: ['Mazda'] },
    );
    const findings = mazdaExclusivityRule.check(a);
    expect(findings.map((f) => [f.severity, f.message.match(/"([^"]+)"/)?.[1]])).toEqual([
      ['error', 'exclusive'],
      ['warning', 'VIP'],
    ]);
  });

  it('leaves the verbatim disclaimer alone ("exclusive of taxes")', async () => {
    const a = await draft();
    const disclaimer = `${a.disclaimer!.text} Prices exclusive of tax, title and license.`;
    blockById(a.template, 'disclaimer').props.text = disclaimer;
    const mazda = asAccount({ ...a, disclaimer: { ...a.disclaimer!, text: disclaimer } }, { oems: ['Mazda'] });
    expect(mazdaExclusivityRule.check(mazda)).toEqual([]);
  });
});

describe('palettes', () => {
  it('Kia: blocks red, flags gray, and ignores the invisible color on image links', async () => {
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'cta-shop').props.bgColor = '#bb162b';
        blockById(t, 'body').props.color = '#3a3a3a';
      }),
      { oems: ['Kia'] },
    );
    const findings = kiaPaletteRule.check(a);
    expect(findings.map((f) => [f.severity, f.excerpt])).toEqual([
      ['warning', '#3a3a3a'],
      ['error', '#bb162b'],
    ]);
    expect(findings[1].message).toContain('Kia emails carry no red');
    // react-email gives the hero image's link color:#067df7 — no text, so not counted.
    expect(findings.some((f) => f.excerpt === '#067df7')).toBe(false);
  });

  it('Honda: allows #0079c0 and nothing else colored', async () => {
    const blue = asAccount(
      await draft((t) => {
        blockById(t, 'cta-shop').props.bgColor = '#0079c0';
      }),
      { oems: ['Honda'] },
    );
    expect(hondaPaletteRule.check(blue)).toEqual([]);

    const red = asAccount(
      await draft((t) => {
        blockById(t, 'cta-shop').props.bgColor = '#cc0000';
      }),
      { oems: ['Honda'] },
    );
    expect(hondaPaletteRule.check(red)).toMatchObject([{ severity: 'error', excerpt: '#cc0000' }]);
  });

  it('flags a text link with no color, which inboxes paint default blue', async () => {
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'footer-text').props.text = 'YoungChev.com · <a href="{{unsubscribe_link}}">Unsubscribe</a>';
      }),
      { oems: ['Kia'] },
    );
    expect(kiaPaletteRule.check(a).map((f) => f.message)).toEqual([
      'Link 4 ("Unsubscribe") has no color set, so inboxes show it in their default blue. Kia allows #000000, #ffffff.',
    ]);
  });
});

describe('oem.honda.no-uppercase-name', () => {
  it('catches HONDA in a subject, an alt text and the disclaimer', async () => {
    const base = await draft(
      (t) => {
        blockById(t, 'hero').props.alt = 'THE NEW HONDA ACCORD';
      },
      {
        subjects: [
          { kind: 'initial', text: 'HONDA Accord lease offer' },
          { kind: 'urgent', text: 'Last chance on the Honda Accord' },
        ],
      },
    );
    const disclaimer = `${base.disclaimer!.text} See HONDA dealer for details.`;
    blockById(base.template, 'disclaimer').props.text = disclaimer;
    const a = asAccount({ ...base, disclaimer: { ...base.disclaimer!, text: disclaimer } }, { oems: ['Honda'] });

    const findings = hondaNameRule.check(a);
    expect(findings.map((f) => f.where)).toEqual(['subject 1 (initial)', 'alt:hero', 'block:disclaimer']);
    expect(findings[2].message).toContain('raise it with design');
  });

  it('catches "Honda" in a block set to uppercase', async () => {
    const a = asAccount(
      await draft((t) => {
        blockById(t, 'headline').props.text = 'The new Honda Accord';
        blockById(t, 'headline').props.textTransform = 'uppercase';
      }),
      { oems: ['Honda'] },
    );
    expect(hondaNameRule.check(a)[0].message).toBe('block:headline is set to uppercase, so "Honda" displays as "HONDA".');
  });
});

describe('Volkswagen', () => {
  it('requires #eff1f5 backgrounds', async () => {
    const vw = asAccount(await draft(), { oems: ['Volkswagen'] });
    expect(vwBackgroundRule.check(vw).map((f) => f.where)).toEqual([
      'The page background',
      'The content background',
      'block:footer',
    ]);

    const fixed = asAccount(
      await draft((t) => {
        t.settings.bodyBg = '#eff1f5';
        t.settings.contentBg = '#EFF1F5';
        blockById(t, 'footer').props.bgColor = '#eff1f5';
      }),
      { oems: ['Volkswagen'] },
    );
    expect(vwBackgroundRule.check(fixed)).toEqual([]);
  });

  it('requires square CTAs, including the 4px a button gets by default', async () => {
    const a = asAccount(
      await draft((t) => {
        delete blockById(t, 'cta-shop').props.borderRadius;
        blockById(t, 'cta-trade').props.borderRadiusTopLeft = 6;
      }),
      { oems: ['Volkswagen'] },
    );
    expect(vwSquareCtaRule.check(a).map((f) => f.where)).toEqual(['block:cta-shop', 'block:cta-trade']);
  });
});
