import type { CoopRulePack } from '@/lib/ad-generator/coop-rules';
import { renderEmailTemplate } from '@/lib/email/render';
import type { Block, EmailTemplate } from '@/lib/email/types';
import { evaluateDraft, type DraftEvaluation } from './compliance/registry';
import { NO_FOOTER_LOGO_OEMS } from './compliance/rules/brand';
import { UNSUBSCRIBE_TOKEN } from './compliance/rules/structure';
import type { CopyOption, DraftAccount, DraftArtifact, FactSource } from './compliance/types';
import type { CreativeReading } from './reading';
import { escapeHtml } from './notes';
import { tagLink } from './utm';

/**
 * The email around the creative, assembled by code (docs/email-drafting.md §4,
 * "What code owns and what the model owns").
 *
 * The model's copy goes into the headline, body and button labels, and
 * nowhere else. Everything a rule could fail on for reasons the model can't
 * see is decided here, so the draft passes it by construction:
 *
 *   - the hero is the approved creative itself, linked;
 *   - every link is tagged, each with its own utm_content;
 *   - the disclaimer is the confirmed reading, verbatim, in its own block;
 *   - the footer is the account's logo, camelCase site and Loomi's
 *     unsubscribe tag;
 *   - one palette for every brand: black on white (white on black buttons),
 *     Helvetica, square full-width buttons side by side in Columns. That one
 *     palette satisfies Kia's and Honda's, YAG's font and VW's square CTAs; VW
 *     only changes the surfaces to #eff1f5.
 *
 * Pure, short of rendering.
 */

export interface DraftCopy {
  headline: string;
  /** Paragraphs, in order. */
  body: string[];
  /** One or two buttons: the label, and the purpose code turns into a link (`links.ts`). */
  ctas: { label: string; purpose: string }[];
  heroAlt: string;
  subjects: CopyOption[];
  previews: CopyOption[];
  /** What the copywriter couldn't do, for the proofer. */
  notes: string[];
}

export interface AssemblyAccount {
  dealer: string;
  oems: string[];
  siteDisplay: string | null;
  /** The dealer's site; every link lands here. */
  website: string;
  logoUrl: string | null;
}

export interface Assembled {
  template: EmailTemplate;
  disclaimerBlockId: string | null;
  footerBlockId: string;
}

export const VW_BACKGROUND = '#eff1f5';
const BLACK = '#000000';
const WHITE = '#ffffff';
const FONT = 'Helvetica, Arial, sans-serif';
const FOOTER_LOGO_WIDTH = 200;

function sells(oems: string[], make: string): boolean {
  return oems.some((o) => o.toLowerCase() === make.toLowerCase());
}

/**
 * The footer's background — the page surface. The footer logo is chosen to
 * contrast with it (`logo.ts`), so this is the one place that decides both.
 */
export function footerBackground(oems: string[]): string {
  return sells(oems, 'Volkswagen') ? VW_BACKGROUND : WHITE;
}

/** "youngchev.com" / "www.youngchev.com/" → "https://www.youngchev.com/". */
export function siteUrl(website: string): string {
  const trimmed = website.trim();
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return `${url.origin}/`;
}

/** "Shop Equinox" → "cta-shop-equinox". */
function contentKey(prefix: string, label: string, taken: Set<string>): string {
  const base = `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.replace(/-+$/, '') || prefix;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

export function assembleDraft(input: {
  copy: DraftCopy;
  disclaimer: string | null;
  heroUrl: string;
  account: AssemblyAccount;
  utmCampaign: string;
  /** Where each button goes, by index. Missing → the homepage. */
  ctaUrls?: string[];
}): Assembled {
  const { copy, account, utmCampaign } = input;
  const vw = sells(account.oems, 'Volkswagen');
  const surface = footerBackground(account.oems);
  const site = siteUrl(account.website);
  const taken = new Set<string>();
  const link = (content: string, url = site) => tagLink(url, utmCampaign, content);
  const ctaUrl = (i: number) => input.ctaUrls?.[i] || site;

  const blocks: Block[] = [
    {
      id: 'hero',
      type: 'image',
      // The creative opens what the first button opens: it IS the offer.
      props: { src: input.heroUrl, alt: copy.heroAlt, linkUrl: link(contentKey('hero', 'image', taken), ctaUrl(0)) },
    },
    { id: 'headline', type: 'heading', props: { text: copy.headline, color: BLACK } },
    ...copy.body.map<Block>((text, i) => ({ id: `body-${i + 1}`, type: 'text', props: { text, color: BLACK } })),
  ];

  const buttons: Block[] = copy.ctas.slice(0, 2).map((cta, i) => ({
    id: `cta-${i + 1}`,
    type: 'button',
    props: {
      text: cta.label,
      url: link(contentKey('cta', cta.label, taken), ctaUrl(i)),
      fullWidth: true,
      borderRadius: 0,
      bgColor: BLACK,
      textColor: WHITE,
    },
  }));
  if (buttons.length === 1) blocks.push(buttons[0]);
  if (buttons.length > 1) {
    blocks.push({
      id: 'ctas',
      type: 'columns',
      props: { columnCount: buttons.length, stackOnMobile: true, ...(vw ? { bgColor: VW_BACKGROUND } : {}) },
      // Each cell is a Section holding its button — the shape the editor builds
      // and edits. A bare button in a column renders, but the editor shows the
      // cell as empty ("Drop component") and the button can't be edited.
      children: buttons.map((button, i) => ({
        id: `cta-cell-${i + 1}`,
        type: 'section',
        props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
        children: [button],
      })),
    });
  }

  let disclaimerBlockId: string | null = null;
  if (input.disclaimer?.trim()) {
    disclaimerBlockId = 'disclaimer';
    blocks.push({ id: disclaimerBlockId, type: 'text', props: { text: input.disclaimer, color: BLACK, fontSize: 11 } });
  }

  const footer: Block[] = [];
  const logoAllowed = !NO_FOOTER_LOGO_OEMS.some((o) => sells(account.oems, o));
  if (logoAllowed && account.logoUrl) {
    // 200px, not the Logo block's 140 default: dealer logos are wide lockups
    // (Young Chev's is 659×134), which at 140 render about 28px tall.
    footer.push({ id: 'footer-logo', type: 'logo', props: { src: account.logoUrl, alt: account.dealer, width: FOOTER_LOGO_WIDTH } });
  }
  const siteText = account.siteDisplay?.trim();
  const parts = [
    ...(siteText
      // The href is URL-serialized, so it carries no quote or angle bracket;
      // left unescaped, as the rules and the sender read hrefs literally.
      ? [`<a href="${link(contentKey('footer', 'site', taken))}" style="color:${BLACK}">${escapeHtml(siteText)}</a>`]
      : []),
    `<a href="${UNSUBSCRIBE_TOKEN}" style="color:${BLACK}">Unsubscribe</a>`,
  ];
  footer.push({ id: 'footer-text', type: 'text', props: { allowHtml: true, color: BLACK, text: parts.join(' · ') } });
  blocks.push({ id: 'footer', type: 'section', props: { bgColor: surface }, children: footer });

  const initialSubject = copy.subjects.find((s) => s.kind === 'initial')?.text ?? '';
  const initialPreview = copy.previews.find((p) => p.kind === 'initial')?.text ?? '';
  return {
    template: {
      version: '2',
      subject: initialSubject,
      preheader: initialPreview,
      settings: { bodyBg: surface, contentBg: surface, contentWidth: 600, fontFamily: FONT, textColor: BLACK },
      blocks,
    },
    disclaimerBlockId,
    footerBlockId: 'footer',
  };
}

export interface BuiltDraft {
  copy: DraftCopy;
  artifact: DraftArtifact;
  evaluation: DraftEvaluation;
}

/** Assemble, render with the real renderer, and run every rule — the artifact the registry judges. */
export async function buildDraft(input: {
  copy: DraftCopy;
  reading: CreativeReading;
  account: DraftAccount;
  logoUrl: string | null;
  heroUrl: string;
  website: string;
  utmCampaign: string;
  facts: FactSource[];
  coop: boolean;
  coopPack: CoopRulePack | null;
  ctaUrls?: string[];
}): Promise<BuiltDraft> {
  const assembled = assembleDraft({
    copy: input.copy,
    disclaimer: input.reading.disclaimer?.text ?? null,
    heroUrl: input.heroUrl,
    account: {
      dealer: input.account.dealer,
      oems: input.account.oems,
      siteDisplay: input.account.siteDisplay,
      website: input.website,
      logoUrl: input.logoUrl,
    },
    utmCampaign: input.utmCampaign,
    ctaUrls: input.ctaUrls,
  });
  const html = await renderEmailTemplate(assembled.template);
  const artifact: DraftArtifact = {
    account: input.account,
    coop: input.coop,
    offerType: input.reading.offerType ?? null,
    vehicle: input.reading.vehicle ?? null,
    subjects: input.copy.subjects,
    previews: input.copy.previews,
    template: assembled.template,
    html,
    disclaimer:
      assembled.disclaimerBlockId && input.reading.disclaimer
        ? { text: input.reading.disclaimer.text, blockId: assembled.disclaimerBlockId }
        : null,
    footerBlockId: assembled.footerBlockId,
    facts: input.facts,
    utmCampaign: input.utmCampaign,
    coopPack: input.coopPack,
  };
  return { copy: input.copy, artifact, evaluation: evaluateDraft(artifact) };
}
