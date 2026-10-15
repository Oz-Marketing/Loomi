import type { Block, EmailTemplate } from '@/lib/email/types';
import { REQUEST_TYPES, type RequestType } from './extraction';

/**
 * Drafting templates (docs/email-drafting.md §4.1): a Loomi email template
 * marked for one or more request types, whose layout the drafter uses instead
 * of building its own. A person designs it in the ordinary editor and marks
 * where the drafted parts go by typing a slot token into a block.
 *
 * Pure and client-safe — the template library imports it.
 */

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  model_offer: 'Model / APR offer',
  service_special: 'Service or parts special',
  sales_event: 'Sales event',
  event_invite: 'Event invitation',
  announcement: 'Announcement or notice',
  conquest: 'Conquest',
  other: 'Anything else',
};

/**
 * The slots, each a token typed into a block. A block whose whole content is
 * the token is that slot.
 */
export const DRAFT_SLOTS = {
  hero: { token: '{{draft.hero}}', where: 'an Image block’s image URL', what: 'the approved creative' },
  headline: { token: '{{draft.headline}}', where: 'a Heading or Text block', what: 'the headline' },
  body: { token: '{{draft.body}}', where: 'a Text block', what: 'the body — one block per paragraph, styled like this one' },
  cta1: { token: '{{draft.cta1}}', where: 'a Button’s text', what: 'the first button: its label and link' },
  cta2: { token: '{{draft.cta2}}', where: 'a Button’s text', what: 'the second button, removed when there’s only one' },
  disclaimer: { token: '{{draft.disclaimer}}', where: 'a Text block', what: 'the creative’s disclaimer, word for word, removed when there is none' },
  footer: { token: '{{draft.footer}}', where: 'a Text block', what: 'the footer: the dealer logo and site name' },
} as const;
export type DraftSlot = keyof typeof DRAFT_SLOTS;

/** The request types a template is marked for, from `Template.draftingFor`. */
export function parseDraftingFor(raw: string | null | undefined): RequestType[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? REQUEST_TYPES.filter((t) => parsed.includes(t))
      : [];
  } catch {
    return [];
  }
}

function walk(blocks: Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.children?.length) walk(b.children, visit);
  }
}

export const slotOf = (value: unknown): DraftSlot | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (Object.keys(DRAFT_SLOTS) as DraftSlot[]).find((k) => DRAFT_SLOTS[k].token === v) ?? null;
};

/** The slots a template carries, by where they're legal. */
export function slotsIn(template: EmailTemplate): Set<DraftSlot> {
  const found = new Set<DraftSlot>();
  walk(template.blocks, (b) => {
    const fromText = slotOf(b.props.text);
    if (b.type === 'image' && slotOf(b.props.src) === 'hero') found.add('hero');
    if (fromText === 'headline' && (b.type === 'heading' || b.type === 'text')) found.add('headline');
    if (b.type === 'text' && fromText && ['body', 'disclaimer', 'footer'].includes(fromText)) found.add(fromText);
    if (b.type === 'button' && (fromText === 'cta1' || fromText === 'cta2')) found.add(fromText);
  });
  return found;
}

/**
 * Why a template can't be drafted into, in words for the person marking it.
 * The hero and the body are required — without them the drafted email loses
 * the creative or its copy. The rest are optional: a template may have no
 * buttons, and without a footer slot its last block is the footer.
 */
export function templateSlotProblems(template: EmailTemplate | null): string[] {
  if (!template) return ['Only drag-and-drop templates can be used for drafting.'];
  const slots = slotsIn(template);
  const problems: string[] = [];
  if (!slots.has('hero')) problems.push(`No ${DRAFT_SLOTS.hero.token}: put it in an Image block's image URL, for the approved creative.`);
  if (!slots.has('body')) problems.push(`No ${DRAFT_SLOTS.body.token}: put it in a Text block, for the drafted copy.`);
  if (slots.has('cta2') && !slots.has('cta1')) problems.push(`${DRAFT_SLOTS.cta2.token} without ${DRAFT_SLOTS.cta1.token}.`);
  return problems;
}

// ── Starter templates ────────────────────────────────────────────────────────

/** The shared starter for a request type: `drafting-starter-sales-event`. */
export function starterSlug(type: RequestType): string {
  return `drafting-starter-${type.replace(/_/g, '-')}`;
}

/**
 * A starter drafting template for one request type: the built-in layout —
 * black on white, Helvetica, square full-width buttons side by side — with
 * every slot in place, so the library has one per type without anyone
 * building it, and design can restyle it once for every draft after.
 * The same look the built-in fallback produces, so it clears every brand rule.
 */
export function starterTemplate(type: RequestType): EmailTemplate {
  const button = (id: string, slot: DraftSlot): Block => ({
    id,
    type: 'button',
    props: { text: DRAFT_SLOTS[slot].token, fullWidth: true, borderRadius: 0, bgColor: '#000000', textColor: '#ffffff' },
  });
  const cell = (id: string, child: Block): Block => ({
    id,
    type: 'section',
    props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
    children: [child],
  });
  return {
    version: '2',
    title: `Drafted email — ${REQUEST_TYPE_LABELS[type]}`,
    settings: { bodyBg: '#ffffff', contentBg: '#ffffff', contentWidth: 600, fontFamily: 'Helvetica, Arial, sans-serif', textColor: '#000000' },
    blocks: [
      { id: 'hero', type: 'image', props: { src: DRAFT_SLOTS.hero.token, alt: '' } },
      { id: 'headline', type: 'heading', props: { text: DRAFT_SLOTS.headline.token, color: '#000000' } },
      { id: 'body', type: 'text', props: { text: DRAFT_SLOTS.body.token, color: '#000000' } },
      {
        id: 'ctas',
        type: 'columns',
        props: { columnCount: 2, stackOnMobile: true },
        children: [cell('cta-cell-1', button('cta-1', 'cta1')), cell('cta-cell-2', button('cta-2', 'cta2'))],
      },
      { id: 'disclaimer', type: 'text', props: { text: DRAFT_SLOTS.disclaimer.token, color: '#000000', fontSize: 11 } },
      { id: 'footer-slot', type: 'text', props: { text: DRAFT_SLOTS.footer.token } },
    ],
  };
}
