/**
 * The OEM offer-email shell — the companion send that ships with a run's ads.
 *
 * WHAT A SHELL IS. `generateOfferEmail` never writes a whole email from a
 * template; it splices the month's offers into one. A shell is an ordinary v2
 * email template carrying a single text block whose content is exactly
 * `{{offers}}` (`OFFERS_PLACEHOLDER`). At generation the run replaces that block
 * with one section per offer — jellybean, vehicle, headline, the manufacturer's
 * verbatim program prose, and that offer's own disclaimer. Everything ABOVE and
 * BELOW the marker is the dealer-facing frame authored here.
 *
 * WHY IT MATCHES THE ADS. The offers are the same offers, so the frame is what
 * has to agree: the dealer's own brand color drives the headings and the CTA
 * (`OfferEmailInput.accentColor`, read from `Account.branding`), the logo block
 * takes the account logo, and the type scale mirrors the plate — one loud line
 * per offer, the legal text small and never dropped. The result reads as the
 * email half of the same collection rather than a different piece of mail.
 *
 * WHY A SEED AND NOT A ONE-OFF. Every environment needs at least one usable
 * shell or `AdTemplateDoc.emailTemplateSlug` has nothing to point at, and a run
 * with a missing shell reports `shell_template_missing` and produces no email.
 * Idempotent on `slug`, so re-running updates the body and never duplicates.
 *
 * Run: npx tsx scripts/seed-oem-offer-email-template.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_SETTINGS, type Block, type EmailTemplate } from '../src/lib/email/types';

export const OEM_OFFER_EMAIL_SLUG = 'oem-monthly-offers';

/** Muted body copy, matched to the disclaimer grey the offer sections use. */
const MUTED = '#666666';

function blocks(): Block[] {
  return [
    // A brand-colored masthead, the way each plate is capped by its brand band.
    // `bgColor` is literal here because a shell is static — the per-offer cards
    // below take the dealer's real accent from `OfferEmailInput.accentColor`, so
    // this stays neutral-dark rather than guessing at a color it cannot know.
    {
      id: 'masthead',
      type: 'section',
      props: {
        bgColor: '#111111',
        paddingTop: 28,
        paddingBottom: 28,
        paddingLeft: 32,
        paddingRight: 32,
      },
      children: [
        // Empty `src` on purpose — `resolveLogoBlocks` fills it with the
        // account's logo at build time, or drops the block when there is none.
        { id: 'logo', type: 'logo', props: { src: '', alt: 'Dealership', width: 170, align: 'center' } },
        {
          id: 'h-1',
          type: 'heading',
          props: {
            text: 'This month’s offers',
            level: 1,
            fontSize: 32,
            align: 'center',
            color: '#ffffff',
            marginBottom: 6,
          },
        },
        {
          id: 't-1',
          type: 'text',
          props: {
            text: 'Straight from the manufacturer, on the models we have in stock right now.',
            fontSize: 14,
            lineHeight: 1.55,
            align: 'center',
            color: '#b8b8b8',
          },
        },
      ],
    },

    { id: 'sp-1', type: 'spacer', props: { height: 24 } },

    // THE SLOT. `spliceOffers` finds this and swaps in one card per offer plus
    // the button to the dealer's inventory; if no slot is present the run
    // refuses with `shell_template_no_placeholder` rather than sending an empty
    // email, so do not delete it.
    //
    // A real `offers` BLOCK, which is what the email palette drops in — not the
    // legacy `{{offers}}` text marker. Both still work (`isOffersSlot`), but a
    // shell carrying BOTH is the trap: only the first is filled and the rest are
    // dropped, so a designer who drags the block into a marker-based shell would
    // otherwise have silently had two.
    { id: 'offers-slot', type: 'offers', props: {} },

    { id: 'sp-2', type: 'spacer', props: { height: 28 } },

    // Closing frame. No second CTA — `offerBlocks` already appends the one
    // pointing at the dealer's site, and two competing buttons is how a send
    // stops converting.
    {
      id: 'closing',
      type: 'section',
      props: {
        bgColor: '#f2f2f2',
        paddingTop: 24,
        paddingBottom: 24,
        paddingLeft: 28,
        paddingRight: 28,
        borderRadiusTopLeft: 10,
        borderRadiusTopRight: 10,
        borderRadiusBottomRight: 10,
        borderRadiusBottomLeft: 10,
      },
      children: [
        {
          id: 't-2',
          type: 'text',
          props: {
            text: 'Want one of these held for you?',
            fontSize: 16,
            fontWeight: 700,
            align: 'center',
            color: '#111111',
            marginBottom: 4,
          },
        },
        {
          id: 't-3',
          type: 'text',
          props: {
            text: 'Reply to this email and we’ll set it aside.',
            fontSize: 14,
            align: 'center',
            color: MUTED,
          },
        },
      ],
    },

    { id: 'sp-3', type: 'spacer', props: { height: 16 } },
    {
      id: 't-4',
      type: 'text',
      props: {
        text: 'Offers shown are the manufacturer’s published programs and are subject to their terms, credit approval and vehicle availability. See each offer above for its full disclosure.',
        fontSize: 10,
        lineHeight: 1.5,
        align: 'center',
        color: '#999999',
      },
    },
  ];
}

export function oemOfferEmailTemplate(): EmailTemplate {
  return {
    version: '2',
    title: 'OEM Monthly Offers',
    // Left unset on purpose: `generateOfferEmail` stamps the real subject and
    // preheader from the run (dealer name + the offers it featured), and a
    // hardcoded one here would be overwritten every time anyway.
    // A slightly cooler page ground than the default so the white offer cards
    // read as cards rather than as the page itself.
    settings: { ...DEFAULT_SETTINGS, contentWidth: 600, bodyBg: '#eeeeee' },
    blocks: blocks(),
  };
}

async function main(): Promise<void> {
  const content = JSON.stringify(oemOfferEmailTemplate());
  const row = await prisma.template.upsert({
    where: { slug: OEM_OFFER_EMAIL_SLUG },
    update: { content, title: 'OEM Monthly Offers', published: true, publishedAt: new Date() },
    create: {
      slug: OEM_OFFER_EMAIL_SLUG,
      title: 'OEM Monthly Offers',
      // Account-less: a shared Loomi library template every account inherits,
      // matching how the global ad plates are scoped.
      accountKey: null,
      type: 'design',
      category: 'sales',
      content,
      preheader: 'This month’s manufacturer offers',
      published: true,
      publishedAt: new Date(),
    },
    select: { id: true, slug: true },
  });
  console.log(`[seed-oem-offer-email-template] ready: ${row.slug}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('[seed-oem-offer-email-template] failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
