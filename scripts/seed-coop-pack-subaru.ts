/**
 * Subaru co-op rule pack, transcribed from the Subaru Advertising Fund (SAF)
 * Guidelines, April 2026.
 *
 * SOURCE: "Subaru_SAF_Guidelines_2026.pdf". Citations give the guideline's own
 * infraction number (e.g. 6a) plus the printed page, which is how SAF and Ansira
 * refer to them — so a rejected claim can be matched to a rule here directly.
 *
 * Seeded `verified: false`: findings warn and cannot block until a human checks
 * the transcription against the source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DOCUMENT IS FAR MORE CHECKABLE THAN GM'S, and it exposes three gaps in
 * what the system can currently express. All three are recorded as rules anyway,
 * because a rule that reports "the template has nothing bound to this" is the
 * actionable form of "we can't do this yet":
 *
 *   1. §6a — ANY offer ad must carry at least the last 8 digits of a valid VIN
 *      (or a VON). Not conditional on offer type. Subaru therefore cannot be
 *      automated at all without that retailer's inventory feed, and there is no
 *      Young Subaru feed configured today.
 *   2. §6y — the lease mileage allowance must appear in the body or disclaimer.
 *      There is no mileage field in the system schema.
 *   3. §6x — whether a security deposit is required must be stated. The field
 *      exists (`securityDeposit`) but nothing guarantees the disclaimer states it.
 *
 * NOT EXPRESSIBLE, deliberately omitted rather than approximated:
 *   - §1e retailer logo must not appear larger than the Subaru logo, and §1f
 *     free space equal to 50% of the Star Cluster height. Both are relationships
 *     INSIDE a composite lockup image, or between an element and its neighbours;
 *     we model neither. See the note on `subaru-logo-lockup` below.
 *   - Category 7 MAAP pricing floors — needs the Subaru Official Invoice Price,
 *     which we don't hold.
 *   - §3d "solid background" for vehicle photography. Not asserted because EVOX
 *     cut-outs satisfy it by construction and dealer photos are never used, so
 *     there is nothing for the rule to catch.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-coop-pack-subaru.ts
 */
import { prisma } from '../src/lib/prisma';
import type { CoopRulePack } from '../src/lib/ad-generator/coop-rules';

const SRC = 'Subaru SAF Guidelines, April 2026 (Subaru_SAF_Guidelines_2026.pdf)';
const cite = (infraction: string, page: number) => `${SRC} — §${infraction}, p.${page}`;

const PACK: CoopRulePack = {
  make: 'Subaru',
  version: 'saf-2026-04',
  source: SRC,
  verified: false,
  rules: [
    // ── Category 1: Subaru logo & name ───────────────────────────────────────
    {
      id: 'subaru-logo-required',
      kind: 'required_element',
      field: 'logoUrl',
      severity: 'error',
      description:
        'The Subaru logo must appear prominently in every ad, and may not appear more than once. Supplied here by the sub-account\'s co-branded lockup.',
      citation: cite('1a', 38),
    },
    {
      id: 'subaru-retailer-dba-required',
      kind: 'required_element',
      field: 'dealerName',
      severity: 'error',
      description:
        'All advertising must contain the retailer\'s official DBA exactly as listed on subaru.com. Abbreviations such as "inc" and "LLC" may be omitted.',
      citation: cite('1l', 38),
    },
    {
      id: 'subaru-name-capitalisation',
      kind: 'banned_phrase',
      // §1i: the first letter must always be uppercase. Catches a lower-case
      // "subaru" anywhere in copy. The all-caps-context half of the rule ("if the
      // copy block is uppercase, SUBARU must be too) is not expressible, since
      // `uppercase: true` on an element transforms at render time.
      pattern: '\\bsubaru\\b(?<![Ss]ubaru)',
      severity: 'warning',
      description:
        'The first letter of "Subaru" must be uppercase. Where a whole copy block is set in capitals, every letter of SUBARU must be capital too — that half of the rule can\'t be checked here because templates apply uppercasing at render time.',
      citation: cite('1i', 38),
    },

    // ── Category 3: photography ──────────────────────────────────────────────
    {
      id: 'subaru-vehicle-photo-required',
      kind: 'required_element',
      field: 'vehicleImageUrl',
      severity: 'error',
      description:
        'A print ad of a quarter page or larger must contain a photo of at least one new or CPO Subaru vehicle.',
      citation: cite('3h', 40),
    },
    {
      id: 'subaru-year-and-model-required',
      kind: 'required_element',
      field: 'vehicleName',
      severity: 'error',
      description:
        'All advertising must include the year and model of the vehicle offered, matching the year, model, trim and option codes on the SOA Official Monroney label.',
      citation: cite('6b', 42),
    },

    // ── Category 6: the VIN requirement, which gates Subaru entirely ─────────
    {
      id: 'subaru-vin-required',
      kind: 'required_phrase',
      field: 'disclaimer',
      // At least the last 8 digits of a VIN, or a VON. Checked in the disclaimer
      // because that is one of the three permitted places and the only one we
      // control; "next to the offer" or "one click away" also satisfy SAF.
      pattern: '[A-Z0-9]{8}',
      severity: 'error',
      description:
        'ANY offer ad must include at least the last eight digits of a valid VIN next to the offer, in the disclaimer, or one click away — a VON is acceptable for vehicles without an assigned VIN. This is not conditional on offer type, so Subaru cannot be automated without that retailer\'s inventory feed.',
      citation: cite('6a', 42),
    },
    {
      id: 'subaru-lease-word-required',
      kind: 'required_phrase',
      field: '_offerLabel',
      phrase: 'lease',
      severity: 'error',
      description:
        'The word "lease" must appear in the body of the ad next to the lease payment.',
      citation: cite('6u', 43),
      scope: { offerTypes: ['lease'] },
    },
    {
      id: 'subaru-lease-das-in-body',
      kind: 'required_phrase',
      field: '_offerTerms',
      pattern: 'due at signing|due at delivery',
      severity: 'error',
      description:
        'The total amount due at lease signing or delivery must appear in the BODY of the ad alongside the lease payment — not only in the disclaimer.',
      citation: cite('6w', 43),
      scope: { offerTypes: ['lease'] },
    },
    {
      id: 'subaru-lease-mileage-required',
      kind: 'required_phrase',
      field: 'disclaimer',
      pattern: '\\d{1,3},?\\d{3}\\s*miles?\\s*(per|/)\\s*year|\\d{1,3},?\\d{3}\\s*miles?\\s*annually',
      severity: 'error',
      description:
        'The mileage restriction used to formulate the lease payment (e.g. 10,000 miles per year) must be stated in the body of the ad or the disclaimer. NOTE: there is no mileage field in the system, so nothing can currently satisfy this.',
      citation: cite('6y', 43),
      scope: { offerTypes: ['lease'] },
    },
    {
      id: 'subaru-security-deposit-statement',
      kind: 'required_phrase',
      field: 'disclaimer',
      pattern: 'security deposit',
      severity: 'error',
      description:
        'Whether a security deposit is required must be stated in the body of the ad or the disclaimer — including when none is required.',
      citation: cite('6x', 43),
      scope: { offerTypes: ['lease'] },
    },
    {
      id: 'subaru-no-money-down',
      kind: 'banned_phrase',
      pattern: 'no money down|\\$0 down|zero down',
      severity: 'error',
      description:
        'A price offer must not state or imply "no money down" unless there is genuinely zero cash due, excluding taxes, title and licence.',
      citation: cite('6d', 42),
    },
    {
      id: 'subaru-no-percentage-off',
      kind: 'banned_phrase',
      pattern: 'percentage off|\\d+%\\s*off',
      severity: 'error',
      description:
        'Pricing must not be misleading or use undefined numeric terms. "Percentage off" is only acceptable for service offers and must be clearly defined.',
      citation: cite('6i', 42),
    },

    // ── Prohibited words and phrases (§6l–6s) ────────────────────────────────
    // Transcribed as separate rules per category so a finding names the specific
    // infraction a claim would be denied under, rather than one opaque blocklist.
    {
      id: 'subaru-banned-retailer-cost',
      kind: 'banned_phrase',
      pattern: '\\binvoice\\b|penny over|below retailer cost|our cost|wholesale pricing',
      severity: 'error',
      description: 'References to retailer cost are prohibited: "invoice", "penny over", "below retailer cost", "our cost", "wholesale pricing".',
      citation: cite('6l', 42),
    },
    {
      id: 'subaru-banned-urgency',
      kind: 'banned_phrase',
      pattern:
        'overstocked|blowout|bailout|closeout|\\bslash\\b|\\bcheap\\b|sell-?a-?thon|liquidation|sell down|\\bundercut\\b|\\bclearance\\b',
      severity: 'error',
      description:
        'Urgency-to-sell language is prohibited: "overstocked", "blowout", "bailout", "closeout", "slash", "cheap", "inventory sell-a-thon", "liquidation", "sell down", "undercut", "clearance" (unless announced by SOA with an official campaign).',
      citation: cite('6m', 42),
    },
    {
      id: 'subaru-banned-maap-language',
      kind: 'banned_phrase',
      pattern: "so low they can'?t be advertised|price too low to advertise",
      severity: 'error',
      description: 'Language referencing the MAAP policy is prohibited: "so low they can\'t be advertised", "price too low to advertise".',
      citation: cite('6n', 42),
    },
    {
      id: 'subaru-banned-urgent-discounts',
      kind: 'banned_phrase',
      pattern: 'deep discounts?|\\boutlet\\b|massive discounts?|biggest discounts?|bottom line pricing|save thousands',
      severity: 'error',
      description: 'Urgent-discount language is prohibited: "deep discounts", "outlet", "massive discounts", "biggest discounts", "bottom line pricing", "save thousands".',
      citation: cite('6o', 42),
    },
    {
      id: 'subaru-banned-race-to-bottom',
      kind: 'banned_phrase',
      pattern: 'best price|we will not be undersold|won\'?t be undersold|price match|we\'?ll (meet|beat|match)',
      severity: 'error',
      description:
        'Race-to-the-bottom language is prohibited: "meet", "beat", "match", "best price", "we will not be undersold", "undercut". Transcribed as phrases rather than the bare verbs, which would fire on innocuous copy.',
      citation: cite('6p', 42),
    },
    {
      id: 'subaru-banned-low-credit',
      kind: 'banned_phrase',
      pattern: 'finance anyone|bad credit\\W*no problem|guaranteed credit approval',
      severity: 'error',
      description: 'Low-credit advertising is prohibited: "finance anyone", "bad credit? No problem", "guaranteed credit approval".',
      citation: cite('6q', 43),
    },
    {
      id: 'subaru-banned-special-deals',
      kind: 'banned_phrase',
      // "special financing" and "special savings" are explicitly PERMITTED when
      // advertising exclusive Subaru Motors Finance rates or official SOA events,
      // so the pattern targets only the prohibited constructions.
      pattern: 'special purchase|special price\\b|special buy|employee pricing',
      severity: 'error',
      description:
        'Special-deal language is prohibited: "special purchase", "special price", "special buy", "employee pricing". Note "special financing" and "special savings" ARE permitted for exclusive Subaru Motors Finance rates and official SOA events.',
      citation: cite('6r', 43),
    },
    {
      id: 'subaru-banned-markup',
      kind: 'banned_phrase',
      pattern: 'additional dealer markup|\\bADM\\b|market adjustment|microchip shortage fee',
      severity: 'error',
      description: 'Market and markup language is prohibited: "Additional Dealer Markup (ADM)", "Market Adjustment", "Microchip Shortage Fee".',
      citation: cite('6s', 43),
    },

    // ── Category 4: accolades and superlatives ───────────────────────────────
    {
      id: 'subaru-banned-superlatives',
      kind: 'banned_phrase',
      pattern: '\\bbiggest\\b|\\bnewest\\b|\\bbest\\b|\\blargest\\b|#\\s?1\\b|\\blowest\\b',
      severity: 'error',
      description:
        'Superlatives, accolades, awards and review claims may not be used unless true and completely identified in the ad, substantiated with a source and time frame. Examples given: "biggest", "newest", "best", "largest", "#1", "lowest".',
      citation: cite('4b', 41),
    },

    // ── Category 5: brand exclusivity ────────────────────────────────────────
    {
      id: 'subaru-competitor-names',
      kind: 'banned_phrase',
      pattern:
        '\\b(toyota|honda|mazda|nissan|hyundai|kia|ford|chevrolet|chevy|gmc|buick|jeep|dodge|ram|chrysler|volkswagen|audi|bmw|mercedes|lexus|acura|infiniti|mitsubishi|volvo|tesla)\\b',
      severity: 'error',
      description:
        'SAF-eligible advertising must be Subaru exclusive. No other automotive manufacturer\'s name may be used with the Subaru name in the ad.',
      citation: cite('5a/5b', 41),
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
    update: { source: PACK.source ?? null, rules: JSON.stringify(PACK) },
  });

  console.log(`✔ ${row.make} co-op pack "${row.version}" — ${PACK.rules.length} rules`);
  console.log(`  verified: ${row.verified} (findings are WARNINGS until a human checks them)`);
  console.log();
  console.log('  Requirements nothing in the system can currently satisfy:');
  console.log('    §6a  VIN on every offer ad      → needs a Young Subaru inventory feed');
  console.log('    §6y  lease mileage allowance    → no mileage field exists');
  console.log('    §6x  security-deposit statement → field exists, disclaimer may not state it');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('seed failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
