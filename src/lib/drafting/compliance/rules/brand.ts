import type { Block } from '@/lib/email/types';
import { fontStack, serifIn } from '../fonts';
import { styleDeclarations } from '../html';
import { blockText, copySurfaces, findBlock, walkBlocks } from '../surfaces';
import type { DraftRule, Finding } from '../types';

/**
 * Oz house style — rules that hold for every dealer, with the OEM exceptions
 * (no footer logo) carved out by scope rather than by branching inside a rule.
 */

/** The Young Automotive Group account — its rooftops default to Helvetica. */
export const YAG_GROUP_KEY = 'youngAutomotiveGroup';

/** These OEMs forbid a dealer logo in the footer; everyone else requires one. */
export const NO_FOOTER_LOGO_OEMS = ['Hyundai', 'Audi', 'Volkswagen'];

export const noSerifRule: DraftRule = {
  id: 'fonts.no-serif',
  scope: {},
  summary: 'No serif font anywhere, including fallbacks.',
  check(a) {
    const findings: Finding[] = [];
    const reported = new Set<string>();
    const consider = (value: unknown, where: string) => {
      if (typeof value !== 'string') return;
      const serif = serifIn(value);
      if (!serif || reported.has(serif.toLowerCase())) return;
      reported.add(serif.toLowerCase());
      findings.push({
        severity: 'error',
        message: `${where === 'settings' ? 'The base font' : where} uses "${serif}", a serif. House style is sans-serif only.`,
        where,
        excerpt: value,
      });
    };
    consider(a.template.settings.fontFamily, 'settings');
    walkBlocks(a.template.blocks, (block) => consider(block.props.fontFamily, `block:${block.id}`));
    // What actually renders, including any component's built-in font.
    for (const d of styleDeclarations(a.html)) {
      if (d.prop === 'font-family' || d.prop === 'font') consider(d.value, `rendered <${d.tag}>`);
    }
    return findings;
  },
};

export const yagHelveticaRule: DraftRule = {
  id: 'fonts.yag-helvetica',
  scope: { groups: [YAG_GROUP_KEY] },
  summary: 'Young Automotive Group emails default to Helvetica.',
  check(a) {
    const first = fontStack(a.template.settings.fontFamily ?? '')[0];
    if (first?.toLowerCase() === 'helvetica') return [];
    return [
      {
        severity: 'error',
        message: `The base font is ${first ? `"${first}"` : 'unset'}. Young Automotive Group emails default to Helvetica.`,
        where: 'settings',
        excerpt: a.template.settings.fontFamily,
      },
    ];
  },
};

function footerLogo(footer: Block): Block | null {
  let logo: Block | null = null;
  walkBlocks([footer], (block) => {
    if (logo) return;
    if (block.type === 'logo' || (block.type === 'image' && typeof block.props.src === 'string' && block.props.src)) {
      logo = block;
    }
  });
  return logo;
}

export const dealerLogoRule: DraftRule = {
  id: 'footer.dealer-logo',
  scope: { exceptOems: NO_FOOTER_LOGO_OEMS },
  summary: 'The footer carries the dealer logo.',
  check(a) {
    const footer = findBlock(a.template, a.footerBlockId);
    if (!footer || footerLogo(footer)) return [];
    return [{ severity: 'error', message: 'The footer has no dealer logo.', where: 'footer' }];
  },
};

export const noFooterLogoRule: DraftRule = {
  id: 'oem.no-footer-logo',
  scope: { oems: NO_FOOTER_LOGO_OEMS },
  summary: 'Hyundai, Audi and Volkswagen emails carry no footer logo.',
  check(a) {
    const footer = findBlock(a.template, a.footerBlockId);
    const logo = footer ? footerLogo(footer) : null;
    if (!logo) return [];
    const oem = NO_FOOTER_LOGO_OEMS.find((o) => a.account.oems.some((x) => x.toLowerCase() === o.toLowerCase()));
    return [
      {
        severity: 'error',
        message: `${oem} emails carry no logo in the footer. Remove it.`,
        where: `block:${logo.id}`,
      },
    ];
  },
};

/** "https://www.YoungChev.com/" → "youngchev.com". */
function hostOf(url: string): string {
  return url
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
}

export const siteUrlRule: DraftRule = {
  id: 'footer.site-url',
  scope: {},
  summary: 'The footer shows the dealer site in camelCase, e.g. YoungCDJRRiverdale.com.',
  check(a) {
    const site = a.account.siteDisplay?.trim();
    if (!site) {
      return [
        {
          severity: 'error',
          message: `${a.account.dealer} has no footer site name on file. Add the camelCase form, e.g. YoungCDJRRiverdale.com, to the account.`,
          where: 'footer',
        },
      ];
    }
    const findings: Finding[] = [];
    if (!/^[A-Za-z0-9-]+(\.[A-Za-z]{2,})+$/.test(site) || /^www\./i.test(site) || !/[A-Z]/.test(site)) {
      findings.push({
        severity: 'error',
        message: `"${site}" isn't a camelCase site name like YoungCDJRRiverdale.com.`,
        where: 'account',
        excerpt: site,
      });
    }
    const footer = findBlock(a.template, a.footerBlockId);
    if (footer) {
      const texts: string[] = [];
      walkBlocks([footer], (block) => texts.push(blockText(block)));
      if (!texts.some((t) => t.includes(site))) {
        findings.push({ severity: 'error', message: `The footer doesn't show the site as "${site}".`, where: 'footer' });
      }
    }
    if (a.account.website && hostOf(a.account.website) !== site.toLowerCase()) {
      findings.push({
        severity: 'warning',
        message: `"${site}" isn't ${hostOf(a.account.website)}, the website on file. Confirm it goes to the dealer's site.`,
        where: 'footer',
      });
    }
    return findings;
  },
};

/**
 * Shorthand that has turned up for dealer names. Matched case-sensitively — the
 * acronyms are written in capitals — and never inside a longer word, so the
 * "CDJR" in YoungCDJRRiverdale.com is left alone.
 */
export const DEALER_ABBREVIATIONS = ['CDJR', 'CDJRF', 'CJDR', 'YAG', 'YPS', 'YUC', 'T&T'];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const dealerNameRule: DraftRule = {
  id: 'copy.dealer-name-in-full',
  scope: {},
  summary: 'Dealer names are written in full, never abbreviated.',
  check(a) {
    const { dealer, siteDisplay, abbreviations = [] } = a.account;
    const patterns = [
      ...abbreviations
        .filter((s) => s.trim())
        .map((s) => new RegExp(`(?<![\\w&])${escapeRe(s.trim())}(?![\\w&])`, 'i')),
      ...DEALER_ABBREVIATIONS.map((s) => new RegExp(`(?<![\\w&])${escapeRe(s)}(?![\\w&])`)),
    ];
    const findings: Finding[] = [];
    for (const surface of copySurfaces(a)) {
      // The full name and the site name may contain the shorthand legitimately.
      let text = surface.text;
      for (const allowed of [dealer, siteDisplay]) {
        if (allowed) text = text.replace(new RegExp(escapeRe(allowed), 'gi'), ' ');
      }
      const hit = patterns.map((re) => text.match(re)?.[0]).find(Boolean);
      if (!hit) continue;
      findings.push({
        severity: 'error',
        message: `${surface.where} shortens the dealer name ("${hit}"). Write "${dealer}".`,
        where: surface.where,
        excerpt: surface.text,
      });
    }
    return findings;
  },
};
