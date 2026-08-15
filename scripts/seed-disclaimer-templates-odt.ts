/**
 * Seed disclaimer templates.
 *
 * Two sources:
 *  - Oz Dealer Tools' Monthly Offers system (`disclaimer_templates` cPanel
 *    export, 2026-07-01) — the Kia APR row.
 *  - The Co-op team's custom-offer disclaimer set (2026-08) — the full-length
 *    Audi and Volkswagen bodies. These are the only two brands in that set with
 *    real manufacturer language; the other 17 ship placeholders and are
 *    deliberately NOT seeded. See docs/custom-offer-disclaimer-builder.md §10.
 *
 * Body translation for Loomi's token engine:
 *  - `{{year}} {{make}} {{model}} {{trim}}` → `{{vehicle}}` (Loomi's combined Vehicle field)
 *  - literal `$` before money slugs removed — Loomi's substitution formats those
 *    as "$45,000" already. NOTE: `{{cost_per_thousand}}` is NOT currency-formatted
 *    (it's a decimal rate like 18.37), so it KEEPS its literal `$`.
 *  - `{APR}%` → `{{apr_rate}}` — Loomi's apr_rate carries its own percent sign.
 *
 *  - the supplied `©2026` notice → `©{{copyright_year}}`, which resolves to the
 *    year the disclaimer is composed. Hardcoding it would have quietly shipped
 *    the wrong year on every ad from 1 January until someone noticed.
 *
 * EVERY ROW IS `isDefault: false`, INCLUDING THE NEW ONES. `isDefault` is what
 * lets a template auto-apply on the UNATTENDED path (see disclaimer-resolve.ts) —
 * and these bodies depend on fields nobody has filled in yet: selling price,
 * customer down, acquisition and disposition fees, overage rate. Unfilled tokens
 * are left VISIBLE on purpose, so flagging these as default today would print
 * "{{acquisition_fee}}" onto generated Audi and VW creative. Flip them to true
 * once the fields are populated for the accounts that run these brands.
 *
 * Skipped: the "Oz Lease" row (make "Oz" — a test entry, not a real OEM).
 *
 * Idempotent by (make, offerType, name). Run:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-disclaimer-templates-odt.ts
 */
import { prisma } from '../src/lib/prisma';

const TEMPLATES: { make: string; offerType: string; name: string; body: string; isDefault: boolean }[] = [
  {
    make: 'Kia',
    offerType: 'apr',
    name: 'Kia APR Disclaimer',
    isDefault: false,
    body:
      '{{apr_rate}} APR for {{apr_term}} months. ${{cost_per_thousand}} per month per $1,000 financed at {{apr_term}} months. ' +
      'APR financing subject to credit approval by {{financial_institution}} for well-qualified buyers. Not all customers ' +
      'will qualify for advertised APR. Subject to vehicle availability and dealer participation. New vehicles only. ' +
      'Must take from retail stock by {{offer_end_date}}. Finance contract must be signed and dated no later than ' +
      '{{offer_end_date}}. Limited inventory available.',
  },

  // ── Audi ───────────────────────────────────────────────────────────────────
  {
    make: 'Audi',
    offerType: 'lease',
    name: 'Audi Lease',
    isDefault: false,
    body:
      'Closed end lease financing available through {{offer_end_date}} for a new, unused {{vehicle}}, on approved credit ' +
      'to well-qualified lessees by Audi Financial Services through participating Audi dealers. Monthly lease payment ' +
      'based on MSRP of {{msrp}} and destination charges, less a suggested dealer contribution resulting in a Selling ' +
      'Price of {{selling_price}}. Excludes tax, title, license, options and dealer fees. Amount due at signing includes ' +
      "first month's payment, customer down payment of {{customer_down}}, and acquisition fee of {{acquisition_fee}}. " +
      'Monthly payments total {{monthly_payments_total}}. Your payment will vary based on dealer contribution and the ' +
      'final negotiated price. At lease end, lessee responsible for disposition fee of {{disposition_fee}}, ' +
      '{{overage_rate}}/mile over {{total_miles}} miles and excessive wear and use. No security deposit required. ' +
      'VIN: {{vin}}. {{dealership_name}}. Offer ends {{offer_end_date}}. ©{{copyright_year}} Audi of America, Inc.',
  },
  {
    make: 'Audi',
    offerType: 'apr',
    name: 'Audi APR',
    isDefault: false,
    body:
      '{{apr_rate}} APR financing available through {{offer_end_date}} for a new, unused {{vehicle}}, on approved credit ' +
      'to well-qualified customers by Audi Financial Services through participating Audi dealers. Monthly payment of ' +
      '{{monthly_payment}} based on amount financed of {{amount_financed}} for {{apr_term}} months at {{apr_rate}} APR ' +
      'with {{customer_down}} customer down payment. Monthly payments total {{monthly_payments_total}}. Excludes tax, ' +
      'title, license, options and dealer fees. Not all buyers will qualify. VIN: {{vin}}. {{dealership_name}}. ' +
      'Offer ends {{offer_end_date}}. ©{{copyright_year}} Audi of America, Inc.',
  },
  {
    make: 'Audi',
    offerType: 'sales_price',
    name: 'Audi Purchase Price',
    isDefault: false,
    body:
      '{{sale_price}} purchase price available through {{offer_end_date}} for a new, unused {{vehicle}}. Based on MSRP ' +
      'of {{msrp}}. Excludes tax, title, license, options and dealer fees. VIN: {{vin}}. {{dealership_name}}. ' +
      'Offer ends {{offer_end_date}}. ©{{copyright_year}} Audi of America, Inc.',
  },

  // ── Volkswagen ─────────────────────────────────────────────────────────────
  // Replaces the earlier ODT row, which rendered the Selling Price as the MSRP
  // and "Monthly payments total" as the monthly payment, and hardcoded one
  // dealer's $699 / $395 / $0.20 / 30,000 figures for every dealer.
  {
    make: 'Volkswagen',
    offerType: 'lease',
    name: 'Volkswagen Lease',
    isDefault: false,
    body:
      'Closed end lease financing available through {{offer_end_date}} for a new, unused {{vehicle}}, on approved credit ' +
      'to well-qualified customers by Volkswagen Financial Services through participating dealers in {{states}}. Monthly ' +
      'lease payment based on MSRP of {{msrp}} and destination charges, less a suggested dealer contribution resulting ' +
      'in a Selling Price of {{selling_price}}. Excludes tax, title, license, options and dealer fees. Amount due at ' +
      "signing includes first month's payment, customer down payment of {{customer_down}}, and acquisition fee of " +
      '{{acquisition_fee}}. Monthly payments total {{monthly_payments_total}}. Your payment will vary based on dealer ' +
      'contribution and the final negotiated price. At lease end, lessee responsible for disposition fee of ' +
      '{{disposition_fee}}, {{overage_rate}}/mile over {{total_miles}} miles and excessive wear and use. A ' +
      '{{disposition_fee}} fee applies if you purchase your lease vehicle. No security deposit required. Offer not ' +
      'valid in Puerto Rico. Offer not associated with a national Volkswagen incentive program. VIN: {{vin}}. ' +
      '{{dealership_name}}. Offer ends {{offer_end_date}}. ©{{copyright_year}} Volkswagen of America, Inc.',
  },
  {
    make: 'Volkswagen',
    offerType: 'apr',
    name: 'Volkswagen APR',
    isDefault: false,
    body:
      '{{apr_rate}} APR financing available through {{offer_end_date}} for a new, unused {{vehicle}}, on approved credit ' +
      'to well-qualified customers by {{financial_institution}} through participating dealers. Monthly payment of ' +
      '{{monthly_payment}} based on amount financed of {{amount_financed}} for {{apr_term}} months at {{apr_rate}} APR ' +
      'with {{customer_down}} customer down payment. Monthly payments total {{monthly_payments_total}}. Excludes tax, ' +
      'title, license, options and dealer fees. Not all buyers will qualify. Your payment will vary based on dealer ' +
      'contribution and the final negotiated price. Offer not valid in Puerto Rico. Offer not associated with a ' +
      'national Volkswagen incentive program. VIN: {{vin}}. {{dealership_name}}. Offer ends {{offer_end_date}}. ' +
      '©{{copyright_year}} Volkswagen of America, Inc.',
  },
  {
    make: 'Volkswagen',
    offerType: 'sales_price',
    name: 'Volkswagen Purchase Price',
    isDefault: false,
    body:
      '{{sale_price}} purchase price available through {{offer_end_date}} for a new, unused {{vehicle}}. Based on MSRP ' +
      'of {{msrp}}. Excludes tax, title, license, options and dealer fees. Offer not valid in Puerto Rico. Offer not ' +
      'associated with a national Volkswagen incentive program. VIN: {{vin}}. {{dealership_name}}. ' +
      'Offer ends {{offer_end_date}}. ©{{copyright_year}} Volkswagen of America, Inc.',
  },
];

async function main() {
  for (const t of TEMPLATES) {
    const existing = await prisma.adDisclaimerTemplate.findFirst({
      where: { make: t.make, offerType: t.offerType, name: t.name },
    });
    if (existing) {
      await prisma.adDisclaimerTemplate.update({
        where: { id: existing.id },
        data: { body: t.body, isDefault: t.isDefault, isActive: true },
      });
      console.log(`updated disclaimer template: ${t.make} / ${t.offerType} / ${t.name}`);
    } else {
      await prisma.adDisclaimerTemplate.create({
        data: { make: t.make, offerType: t.offerType, name: t.name, body: t.body, isDefault: t.isDefault },
      });
      console.log(`created disclaimer template: ${t.make} / ${t.offerType} / ${t.name}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
