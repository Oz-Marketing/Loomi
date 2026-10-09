import { renderEmailTemplate } from '@/lib/email/render';
import type { Block, EmailTemplate } from '@/lib/email/types';
import { tagLink } from '../../utm';
import { UNSUBSCRIBE_TOKEN } from '../rules/structure';
import type { DraftAccount, DraftArtifact } from '../types';

/**
 * A draft that passes every rule, for tests to break one thing at a time.
 *
 * Young Chevrolet's Equinox ACTIV offer, built the way the assembler will
 * build drafts: Helvetica, black and white, square full-width CTAs side by
 * side, every link tagged, the disclaimer verbatim, and a footer with the
 * dealer logo, the camelCase site and Loomi's unsubscribe link.
 * Black and white also satisfies the Kia and Honda palettes, so OEM tests can
 * reuse it by swapping the account.
 *
 * HTML is rendered through the real renderer, so the HTML rules are tested
 * against react-email's actual output rather than hand-written markup.
 */

export const CAMPAIGN = 'equinox-activ-monthly-offer-october-2026';

export const DISCLAIMER =
  'MSRP $36,995 for 2026 Equinox ACTIV. $3,500 off MSRP. Not compatible with some other offers. Take delivery by 10/31/2026. See Young Chevrolet for details.';

export const YOUNG_CHEVROLET: DraftAccount = {
  key: 'youngChevrolet',
  dealer: 'Young Chevrolet',
  oems: ['Chevrolet'],
  groupKeys: ['youngAutomotiveGroup'],
  siteDisplay: 'YoungChev.com',
  website: 'https://www.youngchev.com/',
};

const link = (path: string, content: string) => tagLink(`https://www.youngchev.com${path}`, CAMPAIGN, content);

export function baseTemplate(): EmailTemplate {
  return {
    version: '2',
    subject: 'Save $3,500 on the new 2026 Chevy Equinox ACTIV',
    preheader: '$3,500 off MSRP on the 2026 Equinox ACTIV at Young Chevrolet.',
    settings: {
      bodyBg: '#ffffff',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: 'Helvetica, Arial, sans-serif',
      textColor: '#000000',
    },
    blocks: [
      {
        id: 'hero',
        type: 'image',
        props: {
          src: 'https://cdn.example.com/equinox-activ.png',
          alt: '2026 Chevrolet Equinox ACTIV, $3,500 off MSRP',
          linkUrl: link('/new/equinox', 'hero-image'),
        },
      },
      { id: 'headline', type: 'heading', props: { text: 'The 2026 Equinox ACTIV, $3,500 off', color: '#000000' } },
      {
        id: 'body',
        type: 'text',
        props: {
          text: 'Take $3,500 off MSRP on a new 2026 Chevy Equinox ACTIV at Young Chevrolet. The offer ends Oct 31.',
          color: '#000000',
        },
      },
      {
        id: 'ctas',
        type: 'columns',
        props: { columnCount: 2, stackOnMobile: true },
        children: [
          {
            id: 'cta-shop',
            type: 'button',
            props: { text: 'Shop Equinox', url: link('/new/equinox', 'cta-shop'), fullWidth: true, borderRadius: 0, bgColor: '#000000', textColor: '#ffffff' },
          },
          {
            id: 'cta-trade',
            type: 'button',
            props: { text: 'Value your trade', url: link('/trade', 'cta-trade'), fullWidth: true, borderRadius: 0, bgColor: '#000000', textColor: '#ffffff' },
          },
        ],
      },
      { id: 'disclaimer', type: 'text', props: { text: DISCLAIMER, color: '#000000', fontSize: 11 } },
      {
        id: 'footer',
        type: 'section',
        props: { bgColor: '#ffffff' },
        children: [
          { id: 'footer-logo', type: 'logo', props: { src: 'https://cdn.example.com/young-chevrolet.png', alt: 'Young Chevrolet' } },
          {
            id: 'footer-text',
            type: 'text',
            props: {
              allowHtml: true,
              color: '#000000',
              text: `<a href="${link('/', 'footer-site')}" style="color:#000000">YoungChev.com</a> · <a href="${UNSUBSCRIBE_TOKEN}" style="color:#000000">Unsubscribe</a>`,
            },
          },
        ],
      },
    ],
  };
}

/** The first block with `id`, for a test to edit in place. */
export function blockById(template: EmailTemplate, id: string): Block {
  let found: Block | undefined;
  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.id === id) found = b;
      if (b.children) visit(b.children);
    }
  };
  visit(template.blocks);
  if (!found) throw new Error(`fixture has no block "${id}"`);
  return found;
}

/**
 * A compliant draft, optionally edited. `edit` changes the template before it
 * is rendered; `patch` replaces artifact fields afterward.
 */
export async function draft(
  edit?: (template: EmailTemplate) => void,
  patch: Partial<DraftArtifact> = {},
): Promise<DraftArtifact> {
  const template = baseTemplate();
  edit?.(template);
  const html = await renderEmailTemplate(template);
  return {
    account: YOUNG_CHEVROLET,
    coop: false,
    offerType: 'cash',
    vehicle: { year: 2026, make: 'Chevrolet', model: 'Equinox', trim: 'ACTIV' },
    subjects: [
      { kind: 'initial', text: 'Save $3,500 on the new 2026 Chevy Equinox ACTIV' },
      { kind: 'urgent', text: 'Last chance: $3,500 off the 2026 Equinox ACTIV ends Oct 31' },
    ],
    previews: [
      { kind: 'initial', text: '$3,500 off MSRP on the 2026 Equinox ACTIV at Young Chevrolet.' },
      { kind: 'urgent', text: 'The $3,500 Equinox ACTIV offer ends Oct 31 at Young Chevrolet.' },
    ],
    template,
    html,
    disclaimer: { text: DISCLAIMER, blockId: 'disclaimer' },
    footerBlockId: 'footer',
    facts: [
      { label: 'extraction.headline', text: '2026 Chevrolet Equinox ACTIV, $3,500 off MSRP' },
      { label: 'extraction.expiration', text: 'Offer ends 10/31/2026' },
      { label: 'extraction.disclaimer', text: DISCLAIMER },
    ],
    utmCampaign: CAMPAIGN,
    coopPack: null,
    ...patch,
  };
}

/** The same draft for another store — for scoping and OEM tests. */
export function asAccount(artifact: DraftArtifact, account: Partial<DraftAccount>): DraftArtifact {
  return { ...artifact, account: { ...artifact.account, ...account } };
}
