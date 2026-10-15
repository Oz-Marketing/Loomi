import type { CoopRulePack } from '@/lib/ad-generator/coop-rules';
import { renderEmailTemplate } from '@/lib/email/render';
import type { Block, EmailTemplate } from '@/lib/email/types';
import { evaluateDraft, type DraftEvaluation } from './compliance/registry';
import { NO_FOOTER_LOGO_OEMS } from './compliance/rules/brand';
import type { CopyOption, DraftAccount, DraftArtifact, FactSource } from './compliance/types';
import type { CreativeReading } from './reading';
import { escapeHtml } from './notes';
import { slotOf, templateSlotProblems } from './template-slots';
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
 *   - the footer is the account's logo and camelCase site — no unsubscribe
 *     link, which the send adds;
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

/**
 * The footer: the dealer logo (unless the make bars it) and the camelCase site.
 * `siteLink` returns the tagged link to the site.
 */
function footerSection(account: AssemblyAccount, siteLink: (key: string) => string): Block {
  const footer: Block[] = [];
  const logoAllowed = !NO_FOOTER_LOGO_OEMS.some((o) => sells(account.oems, o));
  if (logoAllowed && account.logoUrl) {
    // 200px, not the Logo block's 140 default: dealer logos are wide lockups
    // (Young Chev's is 659×134), which at 140 render about 28px tall.
    footer.push({ id: 'footer-logo', type: 'logo', props: { src: account.logoUrl, alt: account.dealer, width: FOOTER_LOGO_WIDTH } });
  }
  // No unsubscribe link: Loomi's send-time footer adds it, and SendGrid fills
  // in each recipient's URL (Connor, 2026-10-15). Templates don't carry one.
  const siteText = account.siteDisplay?.trim();
  if (siteText) {
    // The href is URL-serialized, so it carries no quote or angle bracket;
    // left unescaped, as the rules and the sender read hrefs literally.
    const text = `<a href="${siteLink('site')}" style="color:${BLACK}">${escapeHtml(siteText)}</a>`;
    footer.push({ id: 'footer-text', type: 'text', props: { allowHtml: true, color: BLACK, text } });
  }
  return { id: 'footer', type: 'section', props: { bgColor: footerBackground(account.oems) }, children: footer };
}

export interface AssembleInput {
  copy: DraftCopy;
  disclaimer: string | null;
  heroUrl: string;
  account: AssemblyAccount;
  utmCampaign: string;
  /** Where each button goes, by index. Missing → the homepage. */
  ctaUrls?: string[];
}

export function assembleDraft(input: AssembleInput): Assembled {
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

  blocks.push(footerSection(account, (key) => link(contentKey('footer', key, taken))));

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

/**
 * The drafted email in a marked template's layout (docs/email-drafting.md
 * §4.1): each {{draft.*}} slot is filled; everything else is the template's
 * own. Returns the problem instead when the template can't take a draft.
 *
 *   - hero: the creative, linked where the first button goes;
 *   - headline; body (one block per paragraph, each styled like the slot);
 *   - cta1 / cta2: label and tagged link — a slot with no button is removed,
 *     and a Columns row left with one button becomes that button;
 *   - disclaimer: verbatim, removed when the creative has none — and when the
 *     template has no slot, placed before the footer anyway, since it's legal
 *     text the email must carry;
 *   - footer: logo and site; without the slot the template's last block is
 *     the footer the rules check.
 */
export function assembleFromTemplate(input: AssembleInput & { shell: EmailTemplate }): Assembled | { problem: string } {
  const problems = templateSlotProblems(input.shell);
  if (problems.length) return { problem: problems.join(' ') };

  const { copy, account, utmCampaign } = input;
  const site = siteUrl(account.website);
  const taken = new Set<string>();
  const link = (content: string, url = site) => tagLink(url, utmCampaign, content);
  const ctaUrl = (i: number) => input.ctaUrls?.[i] || site;
  const disclaimer = input.disclaimer?.trim() ? input.disclaimer : null;
  let disclaimerBlockId: string | null = null;
  let footerBlockId: string | null = null;

  const fill = (blocks: Block[]): Block[] =>
    blocks.flatMap((b): Block[] => {
      if (b.type === 'image' && slotOf(b.props.src) === 'hero') {
        return [{ ...b, props: { ...b.props, src: input.heroUrl, alt: copy.heroAlt, linkUrl: link(contentKey('hero', 'image', taken), ctaUrl(0)) } }];
      }
      const slot = slotOf(b.props.text);
      if (slot === 'headline' && (b.type === 'heading' || b.type === 'text')) {
        return [{ ...b, props: { ...b.props, text: copy.headline, allowHtml: false } }];
      }
      if (slot === 'body' && b.type === 'text') {
        return copy.body.map((text, i) => ({ ...b, id: `${b.id}-${i + 1}`, props: { ...b.props, text, allowHtml: false } }));
      }
      if (slot === 'disclaimer' && b.type === 'text') {
        if (!disclaimer) return [];
        disclaimerBlockId = b.id;
        return [{ ...b, props: { ...b.props, text: disclaimer, allowHtml: false } }];
      }
      if (slot === 'footer' && b.type === 'text') {
        const footer = footerSection(account, (key) => link(contentKey('footer', key, taken)));
        footerBlockId = footer.id;
        return [footer];
      }
      if ((slot === 'cta1' || slot === 'cta2') && b.type === 'button') {
        const i = slot === 'cta1' ? 0 : 1;
        const cta = copy.ctas[i];
        if (!cta) return [];
        return [{ ...b, props: { ...b.props, text: cta.label, url: link(contentKey('cta', cta.label, taken), ctaUrl(i)) } }];
      }
      if (!b.children?.length) return [b];

      const children = fill(b.children);
      if (b.type === 'columns') {
        // A cell emptied by a removed button goes; one cell left is no row.
        const cells = children.filter((cell, i) => (cell.children?.length ?? 0) > 0 || !(b.children![i].children?.length));
        if (cells.length === 0) return [];
        if (cells.length === 1 && cells.length < children.length) return cells[0].children ?? [];
        return [{ ...b, props: { ...b.props, columnCount: cells.length }, children: cells }];
      }
      return [{ ...b, children }];
    });

  const blocks = fill(structuredClone(input.shell.blocks));
  if (!footerBlockId) footerBlockId = blocks[blocks.length - 1]?.id ?? null;
  if (disclaimer && !disclaimerBlockId) {
    disclaimerBlockId = 'disclaimer';
    const at = blocks.findIndex((b) => b.id === footerBlockId);
    const block: Block = { id: disclaimerBlockId, type: 'text', props: { text: disclaimer, fontSize: 11, color: input.shell.settings.textColor } };
    blocks.splice(at === -1 ? blocks.length : at, 0, block);
  }
  if (!footerBlockId) return { problem: 'The template has no blocks.' };

  return {
    template: {
      ...input.shell,
      subject: copy.subjects.find((x) => x.kind === 'initial')?.text ?? '',
      preheader: copy.previews.find((x) => x.kind === 'initial')?.text ?? '',
      blocks,
    },
    disclaimerBlockId,
    footerBlockId,
  };
}

export interface BuiltDraft {
  copy: DraftCopy;
  artifact: DraftArtifact;
  evaluation: DraftEvaluation;
  /** The marked template's layout was used, not the built-in one. */
  usedShell: boolean;
  /** Why a marked template couldn't be used — its slots, not its rules. */
  shellProblem: string | null;
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
  /** A marked drafting template to fill; without one, or when it can't take a draft, the built-in layout. */
  shell?: EmailTemplate | null;
}): Promise<BuiltDraft> {
  const assembleInput: AssembleInput = {
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
  };
  const fromShell = input.shell ? assembleFromTemplate({ ...assembleInput, shell: input.shell }) : null;
  const shellProblem = fromShell && 'problem' in fromShell ? fromShell.problem : null;
  const assembled = fromShell && !('problem' in fromShell) ? fromShell : assembleDraft(assembleInput);
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
  return {
    copy: input.copy,
    artifact,
    evaluation: evaluateDraft(artifact),
    usedShell: Boolean(fromShell && !('problem' in fromShell)),
    shellProblem,
  };
}
