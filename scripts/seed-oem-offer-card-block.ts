/**
 * The OEM offer card, as an EDITABLE custom block.
 *
 * WHY THIS EXISTS. The card used to be `offerSection()` — built in code, with
 * fixed type sizes, a fixed order and fixed colours. A designer could place it
 * and change nothing a recipient saw. This ships the same layout as a saved
 * `EmailBlock` a designer can open, restyle, reorder and rebuild, which is the
 * whole point of the custom-block work.
 *
 * It is the SAME design, deliberately: dropping it into a shell and generating
 * should produce what the built-in card produced, so the migration is invisible
 * until someone chooses to change it.
 *
 * Idempotent on name. Re-running restores the stock card WITHOUT touching a
 * dealer's edited copy — a designer who has adapted theirs keeps it, because
 * this only writes the row it owns.
 *
 * Run: npx tsx scripts/seed-oem-offer-card-block.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import type { Block } from '../src/lib/email/types';
import { BRAND_ACCENT_PROP, REPEAT_PROP } from '../src/lib/ad-generator/automation/offer-bindings';

export const OEM_OFFER_CARD_BLOCK = 'OEM offer card';

const text = (id: string, body: string, props: Record<string, unknown> = {}): Block => ({
  id,
  type: 'text',
  props: { text: body, fontSize: 15, lineHeight: 1.6, align: 'left', ...props },
});

/**
 * One offer, laid out exactly as `offerSection()` lays it out.
 *
 * The figures come through `{{offer.*}}` tokens rather than being computed here,
 * so they still resolve through `assembleOffer` — the plate's own formatter —
 * and an email cannot round a payment differently from the ad beside it.
 */
function card(): Block {
  return {
    id: 'oem-card',
    type: 'section',
    props: {
      // The marker that makes a run render this once PER OFFER, however many
      // the month produced.
      [REPEAT_PROP]: 'offer',
      bgColor: '#ffffff',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: '#e2e2e2',
      borderRadiusTopLeft: 10,
      borderRadiusTopRight: 10,
      borderRadiusBottomRight: 10,
      borderRadiusBottomLeft: 10,
      paddingTop: 22,
      paddingBottom: 22,
      paddingLeft: 24,
      paddingRight: 24,
    },
    children: [
      // Bound whole — a picture is one value. Dropped automatically for a model
      // EVOX doesn't cover, which is why an offer with no image still sends.
      { id: 'oem-img', type: 'image', props: { bindTo: 'offer.image', src: '', alt: '', width: 460, maxWidth: '100%', align: 'center' } },
      text('oem-name', '{{offer.name}}', { fontSize: 17, fontWeight: 700, align: 'center', color: '#111111', marginBottom: 2 }),
      text('oem-label', '{{offer.label}}', {
        fontSize: 11, fontWeight: 700, align: 'center', color: '#777777',
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 0,
      }),
      // The figure wears the DEALER'S accent, not a colour baked into the
      // block — this card is global, and one hardcoded colour would put a
      // Chevrolet blue figure on a Honda store's email.
      text('oem-main', '{{offer.main}}', {
        [BRAND_ACCENT_PROP]: true,
        fontSize: 44, fontWeight: 800, align: 'center', color: '#cc0000',
        lineHeight: 1.05, marginTop: 2, marginBottom: 2,
      }),
      text('oem-terms', '{{offer.terms}}', { fontSize: 14, align: 'center', color: '#555555', marginTop: 0 }),
      text('oem-exp', '{{offer.expiration}}', {
        fontSize: 12, fontWeight: 700, align: 'center', color: '#111111',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 6,
      }),
      // The legal strip. Every program has its own terms, so a multi-offer email
      // carries one PER offer — never summarized, never dropped.
      {
        id: 'oem-legal',
        type: 'section',
        props: {
          bgColor: '#f7f7f7', paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16,
          borderRadiusTopLeft: 6, borderRadiusTopRight: 6, borderRadiusBottomRight: 6, borderRadiusBottomLeft: 6,
        },
        children: [
          text('oem-details', '{{offer.offerDetails}}', { fontSize: 10, color: '#777777', lineHeight: 1.5 }),
          text('oem-disc', '{{offer.disclaimer}}', { fontSize: 10, color: '#777777', lineHeight: 1.5 }),
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  const doc = JSON.stringify({ version: 1, blocks: [card()] });
  const existing = await prisma.emailBlock.findFirst({
    where: { name: OEM_OFFER_CARD_BLOCK },
    select: { id: true },
  });
  if (existing) {
    await prisma.emailBlock.update({ where: { id: existing.id }, data: { doc, repeatOver: 'offer', isActive: true } });
    console.log('[seed-oem-offer-card-block] refreshed the stock card');
  } else {
    await prisma.emailBlock.create({
      data: {
        name: OEM_OFFER_CARD_BLOCK,
        description: 'One manufacturer offer — vehicle, figure, terms and disclosure. Repeats per offer.',
        doc,
        repeatOver: 'offer',
        // Global: every account inherits it, like the shared template library.
        accountKeys: null,
        category: 'sales',
      },
    });
    console.log('[seed-oem-offer-card-block] created the stock card');
  }
}

main()
  .catch((err) => {
    console.error('[seed-oem-offer-card-block] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
