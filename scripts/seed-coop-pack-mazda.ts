/**
 * Mazda co-op rule pack, transcribed from the Mazda Co-op Advertising Program
 * (MCAP) Interactive Guidelines, August 2025.
 *
 * SOURCE: "MCAP_Interactive_Guidelines_Aug_2025.pdf". Citations give MCAP's own
 * clause number plus the printed page.
 *
 * Seeded `verified: false`: findings warn and cannot block until a human checks
 * the transcription against the source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  MAZDA CONTRADICTS THREE THINGS THE SYSTEM CURRENTLY DOES. Read this before
 * enabling Mazda automation — none of them are fixed by this pack, which only
 * REPORTS them.
 *
 * 1. §5d — THE CO-BRANDED LOCKUP IS NON-COMPLIANT FOR MAZDA.
 *    "The Mazda logo or any of its components may not appear as a direct lockup
 *    to your dealer name or logo. Separating your name and the Mazda logo with a
 *    line is not sufficient." The guideline prints three NON-COMPLIANT examples,
 *    one of which is exactly a dealer name and Mazda mark divided by a vertical
 *    rule. Compliant layouts keep them as separate elements at prescribed
 *    ratios: dealer NAME at 85% (recommended) or 115% of the Mazda script height,
 *    or a pre-approved dealer LOGO no larger than 50% of the brand mark.
 *    → A single combined lockup image therefore cannot satisfy Mazda, and the
 *      account's `logoUrl` is exactly that. Mazda needs the brand mark and the
 *      dealer identity as two elements with a size relationship between them.
 *
 * 2. §6a/§6b — MAZDA ADS MUST BE MONOCHROME.
 *    "All typography is to be set in monochrome tones only (black, gray, white)."
 *    The brand colour palette is greyscale plus black and white; "no other color
 *    is permitted unless vehicle photography is used", and colour explicitly may
 *    not be used to highlight prices or CTAs.
 *    → The Offer Headline template is brand-colour driven: a coloured band and a
 *      coloured price. That is non-compliant for Mazda regardless of which colour
 *      the sub-account sets. Mazda needs a greyscale variant.
 *
 * 3. §8c — VEHICLE NAMES MUST BE UPPERCASE WHEN STANDING ALONE.
 *    "2024 MAZDA3 SEDAN" is compliant; "2024 Mazda3 Sedan" is not. Also Mazda3
 *    is one word with a capital M and no space before the numeral, while CX/MX
 *    lines take a space and a hyphen ("Mazda CX-90").
 *    → MarketCheck supplies "2026 Mazda CX-5" — body-text form. Our headline is
 *      standalone copy, so it needs uppercasing for Mazda.
 *
 * NOT EXPRESSIBLE, omitted rather than approximated:
 *   - §7b the price/offer height may not exceed the height of the vehicle. A
 *     genuine geometric rule, but it compares TWO elements' heights and the rule
 *     engine has no cross-element comparison. Worth adding.
 *   - §5c clear space of 50% (print) / 20% (digital) of the logo length, and the
 *     §5d size ratios — element-to-neighbour relationships we don't model.
 *   - §6a Mazda Type font requirement — we don't know which font file a template
 *     resolves to at render time.
 *   - §1a–1h MAAP/LABLP pricing floors — need Dealer Invoice and the monthly
 *     LABLP figure, neither of which we hold.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-coop-pack-mazda.ts
 */
import { prisma } from '../src/lib/prisma';
import type { CoopRulePack } from '../src/lib/ad-generator/coop-rules';

const SRC = 'Mazda MCAP Interactive Guidelines, Aug 2025 (MCAP_Interactive_Guidelines_Aug_2025.pdf)';
const cite = (clause: string, page: number) => `${SRC} — §${clause}, p.${page}`;

const PACK: CoopRulePack = {
  make: 'Mazda',
  version: 'mcap-2025-08',
  source: SRC,
  verified: false,
  rules: [
    // ── §5 logos, §7 message: required elements ──────────────────────────────
    {
      id: 'mazda-brand-mark-required',
      kind: 'required_element',
      field: 'logoUrl',
      severity: 'error',
      description:
        'The Mazda brand mark must be used once and placed prominently. NOTE §5d: it may NOT appear as a direct lockup to the dealer name or logo — a dividing line is explicitly insufficient — so a single combined lockup asset does not satisfy Mazda.',
      citation: cite('5a/5d', 12),
    },
    {
      id: 'mazda-dealer-dba-required',
      kind: 'required_element',
      field: 'dealerName',
      severity: 'error',
      description:
        'The dealer must clearly identify itself using its full Mazda dealership name (DBA) in all media types.',
      citation: cite('5e', 13),
    },
    {
      id: 'mazda-vehicle-photo-required',
      kind: 'required_element',
      field: 'vehicleImageUrl',
      severity: 'error',
      description:
        'All new-car advertising must feature new Mazda vehicles and include a photo of at least one new Mazda vehicle. Dealer-created running footage is not permitted.',
      citation: cite('7c', 15),
    },
    {
      id: 'mazda-valid-offer-required',
      kind: 'required_element',
      field: '_offerValue',
      severity: 'error',
      description:
        'A valid offer must be included in all media types — MSRP, Dealer Price, APR or Lease. Expired offers are considered non-compliant.',
      citation: cite('7a', 15),
    },
    {
      id: 'mazda-year-make-model-required',
      kind: 'required_element',
      field: 'vehicleName',
      severity: 'error',
      description:
        'Year, make, model and trim are required for the vehicle description when advertising an offer.',
      citation: cite('8b', 16),
    },

    // ── §8c vehicle-line nomenclature ────────────────────────────────────────
    {
      id: 'mazda-vehicle-line-format',
      kind: 'banned_phrase',
      fields: ['vehicleName'],
      // "Mazda3" must be one word, capital M, no space before the numeral.
      // Catches "Mazda 3" and lowercase "mazda3".
      pattern: 'Mazda\\s+\\d|\\bmazda\\d',
      severity: 'error',
      description:
        'Vehicle lines beginning with "Mazda" followed by a number must use an uppercase M with NO space before the number — "Mazda3", never "Mazda 3". CX and MX lines take a space and a hyphen instead ("Mazda CX-90").',
      citation: cite('8b', 16),
    },

    // ── §2a distressed language ──────────────────────────────────────────────
    {
      id: 'mazda-banned-distressed',
      kind: 'banned_phrase',
      pattern:
        'liquidat|overstocked|\\bclearance\\b|employee pricing|closeout|blowout|supplier pricing|red tag|drastically reduced|rock bottom|markdown|fleet pricing|buy one,? get one|\\bBOGO\\b|special (allocation|pricing|allowance|test pricing|program|discount)',
      severity: 'error',
      description:
        'Distressed or "discount brand" language is prohibited. Listed examples: Liquidate, Overstocked, Clearance, Employee Pricing, Closeout, Blowout, Supplier Pricing, Red Tag Sale, Drastically Reduced, Rock Bottom, Markdown, Fleet Pricing, Buy One Get One (BOGO), Special Allocation/Pricing/Allowance/Test Pricing/Program/Discount.',
      citation: cite('2a', 9),
    },
    {
      id: 'mazda-banned-credit-language',
      kind: 'banned_phrase',
      pattern:
        'no credit,? no problem|bad credit,? no problem|we finance anyone|everyone approved|guaranteed credit approval|no rejections|can\'?t get a loan',
      severity: 'error',
      description:
        'Credit-desperation language is prohibited: "No Credit, No Problem", "Bad Credit, No Problem", "We Finance Anyone", "Everyone Approved", "Guaranteed Credit Approval", "No Rejections", "Can\'t Get A Loan?".',
      citation: cite('2a', 9),
    },
    {
      id: 'mazda-banned-plans',
      kind: 'banned_phrase',
      pattern: '\\bE-?Plan\\b|\\bS-?Plan\\b',
      severity: 'error',
      description: 'Employee/supplier plan references are prohibited: "E-Plan", "S-Plan".',
      citation: cite('2a', 9),
    },
    {
      id: 'mazda-banned-cost-words',
      kind: 'banned_phrase',
      // §2b permits these as part of a vehicle DESCRIPTION or where state law
      // requires, so the pattern targets the pricing senses.
      pattern: '\\binvoice\\b|below cost|our cost|at cost\\b|factory pricing|factory invoice',
      severity: 'error',
      description:
        'The words "cost", "factory" and "invoice", in any variation, are not permitted unless required by state law or used as part of a vehicle description.',
      citation: cite('2b', 9),
    },
    {
      id: 'mazda-banned-favored-status',
      kind: 'banned_phrase',
      pattern: '\\bheadquarters\\b|\\bcorporate\\b|\\bauthorized\\b|only at\\b|exclusively at\\b|other guys',
      severity: 'error',
      description:
        'Claims of favoured status or preferential standing with Mazda corporate are prohibited, as are disparaging comparisons to other Mazda dealers: "Headquarters", "Corporate", "Authorized", "Only at…", "Special deals exclusively at…", "We do deals those other guys can\'t".',
      citation: cite('2e/2f', 9),
    },
    {
      id: 'mazda-banned-superlatives',
      kind: 'banned_phrase',
      pattern: '\\bbiggest\\b|\\bnewest\\b|\\bbest\\b|\\blargest\\b|#\\s?1\\b',
      severity: 'error',
      description:
        'Superlatives such as "biggest", "newest", "best", "largest", "#1" or similar must not be used unless true, correct and substantiated with a source and source year from the previous calendar year.',
      citation: cite('2g', 9),
    },
    {
      id: 'mazda-banned-maap-language',
      kind: 'banned_phrase',
      pattern:
        'prices? too low to (show|advertise)|unlock your (special )?price|click here to unlock',
      severity: 'error',
      description:
        'Advertising must never use distressed language disparaging toward MCAP, e.g. "Prices too low to show per Mazda standards", "Click here to Unlock your Special Price". Strikethrough pricing is likewise prohibited.',
      citation: cite('1d', 7),
    },
    {
      id: 'mazda-brand-exclusivity',
      kind: 'banned_phrase',
      pattern:
        '\\b(toyota|honda|subaru|nissan|hyundai|kia|ford|chevrolet|chevy|gmc|buick|jeep|dodge|ram|chrysler|volkswagen|audi|bmw|mercedes|lexus|acura|infiniti|mitsubishi|volvo|tesla)\\b',
      severity: 'error',
      description:
        'All advertising must maintain Mazda brand exclusivity. Dual and multi-franchise dealers may not advertise competitive makes, logos or multi-branded URLs.',
      citation: cite('2h', 9),
    },
    {
      id: 'mazda-banned-percentage-off',
      kind: 'banned_phrase',
      pattern: '\\d+%\\s*off|\\bXX\\s*off\\b',
      severity: 'warning',
      description:
        'Dealer offers displayed as "XX Off" must also advertise the MSRP so the resulting price can be checked against MAAP. Flagged rather than blocked because the MSRP may legitimately be present.',
      citation: cite('1a', 7),
    },

    // ── §7e sales event periods ──────────────────────────────────────────────
    {
      id: 'mazda-event-logo-standalone',
      kind: 'required_element',
      field: 'eventLogoUrl',
      // Only meaningful while an event is in force. Kept as a warning because the
      // generate step is what actually enforces presence, using the event
      // calendar's date window — a static rule can't know today's window.
      severity: 'warning',
      description:
        'During Mazda Event Campaign Periods the provided sales event logo (or a campaign mention) is mandatory. The event logo may NOT be altered, nor appear as a lockup to the Mazda brand mark, the dealer name or the dealer logo — it must be its own element. Enforcement of presence is handled by the event calendar, not this rule.',
      citation: cite('7e', 15),
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
  console.log(`  verified: ${row.verified}`);
  console.log();
  console.log('  ⚠️  Mazda contradicts three things the system currently does:');
  console.log('    §5d  a combined dealer+Mazda lockup is NON-COMPLIANT (a dividing line is not enough)');
  console.log('    §6b  ads must be MONOCHROME — the brand-colour template is non-compliant for Mazda');
  console.log('    §8c  standalone vehicle names must be UPPERCASE ("2026 MAZDA CX-5")');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('seed failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
