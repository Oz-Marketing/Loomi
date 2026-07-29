/**
 * Chevrolet co-op rule pack, transcribed from the GM iMR Program Guidelines.
 *
 * SOURCE: "imrProgramGuidelines.pdf" — GM in-Market Retail (iMR) Program
 * Guidelines, Sales component. Printed page numbers are cited on each rule (the
 * printed number, not the PDF page index — they differ by 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEEDED `verified: false` ON PURPOSE.
 *
 * Every rule below is a transcription, and a transcription can misread a table
 * or miss a footnote. While unverified, findings are downgraded to warnings and
 * cannot block a dealer's ads. Flipping this to true requires a human reading
 * these rules against the source PDF — that review is the gate for auto-ready.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS DOCUMENT DOES *NOT* CONTAIN, and therefore neither does this pack:
 *
 *   - No minimum type size for disclaimers. The iMR guidelines govern brandmark
 *     presence, dealership identification, vehicle imagery and prohibited
 *     language; they repeatedly defer typography to a separate "divisional
 *     Brand/Ad Standards guide" per brand (pp.10, 15). We have GMCAdStandards.pdf
 *     for GMC/Buick but NOT the Chevrolet equivalent, so no `min_font_size` rule
 *     is asserted here. Inventing one would be worse than having none.
 *   - No logo clear-space check. The rule is real ("clear space around all sides",
 *     p.13) but we don't model an element's distance to its neighbours, so it
 *     isn't expressible yet. Omitted rather than approximated.
 *   - "Use good taste and reflect favorably on the GM brand" (p.12) is not
 *     machine-checkable and is deliberately absent.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-coop-pack-chevrolet.ts
 */
import { prisma } from '../src/lib/prisma';
import type { CoopRulePack } from '../src/lib/ad-generator/coop-rules';

const SOURCE = 'GM iMR Program Guidelines (imrProgramGuidelines.pdf), Sales component';

const PACK: CoopRulePack = {
  make: 'Chevrolet',
  version: 'imr-2026',
  source: SOURCE,
  // See the header — a human must check this against the PDF before it can block.
  verified: false,
  rules: [
    // ── required elements ────────────────────────────────────────────────────
    {
      id: 'gm-brandmark-required',
      kind: 'required_element',
      field: 'oemLogoUrl',
      severity: 'error',
      description:
        'Every ad must carry the Chevrolet brandmark (bowtie + wordmark). A bowtie inside the DEALERSHIP logo explicitly does not satisfy this, and neither do event, partner or Bonus Tag logos.',
      citation: `${SOURCE} — "GRAPHIC STANDARDS AND LOGO/TAGLINE USAGE" › Chevrolet, p.13`,
    },
    {
      id: 'gm-tagline-required',
      kind: 'required_element',
      field: 'oemTagline',
      severity: 'error',
      description:
        'The "Together let\'s drive" tagline is a required element in every advertisement. It should appear locked up with the brandmark; they may only be split when space is limited.',
      citation: `${SOURCE} — "GRAPHIC STANDARDS AND LOGO/TAGLINE USAGE" › Chevrolet, p.13`,
    },
    {
      id: 'gm-dealership-name-required',
      kind: 'required_element',
      field: 'dealerName',
      severity: 'error',
      description:
        'The ad must list the dealership\'s name. Note this is the NAME as text — a dealer logo alone is not stated to satisfy it.',
      citation: `${SOURCE} — "IMR ADVERTISING SPECIFICATIONS", p.12`,
    },
    {
      id: 'gm-vehicle-photo-required',
      kind: 'required_element',
      field: 'vehicleImageUrl',
      severity: 'error',
      description:
        'A New/CPO/CarBravo ad must feature a vehicle photograph. Omitting it is listed as a Major Violation, which permanently forfeits the GM Match on the claim.',
      citation: `${SOURCE} — "Major Violation", p.11`,
    },
    {
      id: 'gm-offer-details-required',
      kind: 'required_element',
      field: '_offerTerms',
      severity: 'error',
      description:
        'The ad must specify the price, promotion or offer AND the details of that offer — the headline figure alone is not sufficient.',
      citation: `${SOURCE} — "IMR ADVERTISING SPECIFICATIONS", p.12`,
    },

    // ── prohibited language ──────────────────────────────────────────────────
    {
      id: 'gm-banned-preferential-status',
      kind: 'banned_phrase',
      // Transcribed from the document's own examples; it states the list is
      // illustrative rather than exhaustive, so this catches those and no more.
      pattern:
        'volume discount from gm|the gm (store|outlet)|gm\'?s official|official tri-county|official lease termination',
      severity: 'error',
      description:
        'Claims implying favoured or preferential standing with GM are not reimbursable (e.g. "Volume discount from GM", "The GM store/outlet", "GM\'s official tri-county dealer", "Official lease termination center").',
      citation: `${SOURCE} — "PREFERENTIAL DEALER-STATUS LANGUAGE", p.13`,
    },
    {
      id: 'gm-banned-distressed',
      kind: 'banned_phrase',
      pattern: 'prices too low to advertise|invoice sale|liquidation sale',
      severity: 'error',
      description:
        'Advertising that implies the brand is distressed is not reimbursable (e.g. "Prices too low to advertise", "Invoice sale", "Liquidation sale").',
      citation: `${SOURCE} — "DISTRESSED BRAND ADVERTISING", p.13`,
    },
    {
      id: 'gm-banned-flush',
      kind: 'banned_phrase',
      pattern: '\\bflush(es|ing|ed)?\\b',
      // Warning, not error: the rule is aimed at SERVICE advertising, and these
      // are vehicle-offer ads. Flagging rather than blocking keeps it visible
      // without asserting it applies to a lease ad.
      severity: 'warning',
      description:
        'Use of the word "flush" with any service is non-compliant — use drain/refill, drain/replace or fluid exchange instead. Aimed at service advertising.',
      citation: `${SOURCE} — "Major Violation" footnote, p.11`,
    },
  ],
};

async function main() {
  const row = await prisma.adCoopRulePack.upsert({
    where: { make_version: { make: PACK.make, version: PACK.version } },
    create: {
      make: PACK.make,
      version: PACK.version,
      source: PACK.source ?? null,
      verified: false,
      isActive: true,
      rules: JSON.stringify(PACK),
    },
    update: {
      source: PACK.source ?? null,
      rules: JSON.stringify(PACK),
    },
  });

  console.log(`✔ ${row.make} co-op pack "${row.version}" — ${PACK.rules.length} rules`);
  console.log(`  verified: ${row.verified} (findings are WARNINGS until a human checks them)`);
  console.log(`  source  : ${row.source}`);
  console.log();
  console.log('  Rules referencing fields the system does not yet have:');
  for (const r of PACK.rules) {
    if ('field' in r && ['oemLogoUrl', 'oemTagline'].includes(r.field)) {
      console.log(`    - ${r.id} → ${r.field}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('seed failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
