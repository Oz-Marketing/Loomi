/**
 * Seed OEM offer-compliance rules ported from Oz Dealer Tools' Monthly Offers
 * system (`oem_offer_rules` cPanel export, 2026-07-01) — the REAL rules the
 * builder enforced (the earlier `ad_oem_required_fields` export was the
 * separate AI Studio's table).
 *
 * Key translation (ODT snake_case → Loomi FieldSpec keys):
 *   offer_end_date → expiration      lease_due     → dueAtSigning
 *   stock_number   → stockNumber     security_deposit → securityDeposit
 *   apr_term/lease_term → aprTerm/leaseTerm         cost_per_thousand → costPerThousand
 *   financial_institution → financialInstitution    discount_source → discountSource
 *   trim → vehicleName (Loomi's combined Vehicle field carries the trim)
 *
 * Sanitization: a required field is kept only on offer types whose form
 * actually exposes it — requiring an unfillable field would block export
 * forever. As of the Subaru parity change, the vehicle-offer + dual-offer forms
 * expose dueAtSigning + securityDeposit on lease/apr/discount/sales_price, so
 * Subaru now matches ODT exactly. Still sanitized: Mazda drops the APR-only keys
 * (cost_per_thousand, financial_institution) from lease/custom, which have no
 * form field there. NOTE: Volkswagen still drops lease_due (dueAtSigning) from
 * apr/sales_price for legacy reasons — that field is now exposed there, so VW
 * could be restored to full ODT parity if desired (not done here).
 *
 * Idempotent upsert. Run:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-oem-rules-odt.ts
 */
import { prisma } from '../src/lib/prisma';

const RULES: { make: string; requiredFields: Record<string, string[]>; notes: string }[] = [
  {
    make: 'Subaru',
    requiredFields: {
      lease: ['vin', 'msrp', 'disclaimer', 'expiration', 'leaseTerm', 'dueAtSigning', 'securityDeposit'],
      apr: ['vin', 'msrp', 'disclaimer', 'expiration', 'dueAtSigning', 'securityDeposit', 'aprTerm'],
      discount: ['vin', 'msrp', 'disclaimer', 'expiration', 'dueAtSigning', 'securityDeposit', 'discountSource'],
      sales_price: ['vin', 'msrp', 'disclaimer', 'expiration', 'dueAtSigning', 'securityDeposit'],
      custom: ['vin', 'expiration'],
    },
    notes: 'Ported from ODT Monthly Offers oem_offer_rules — exact match. dueAtSigning + securityDeposit required on all offer types (the vehicle-offer form exposes them on lease/apr/discount/sales_price to satisfy this).',
  },
  {
    make: 'Kia',
    requiredFields: {
      lease: ['msrp', 'disclaimer', 'expiration', 'leaseTerm', 'dueAtSigning'],
      apr: ['disclaimer', 'expiration', 'aprTerm', 'financialInstitution', 'costPerThousand'],
      discount: ['msrp', 'disclaimer', 'expiration', 'discountSource'],
      sales_price: ['vin', 'msrp', 'disclaimer', 'expiration'],
      custom: ['disclaimer', 'expiration'],
    },
    notes: 'Ported from ODT Monthly Offers oem_offer_rules.',
  },
  {
    make: 'Mazda',
    requiredFields: {
      lease: ['msrp', 'disclaimer', 'expiration', 'leaseTerm', 'dueAtSigning'],
      apr: ['disclaimer', 'expiration', 'aprTerm', 'financialInstitution', 'costPerThousand'],
      discount: ['vehicleName', 'disclaimer', 'expiration', 'discountSource'],
      sales_price: ['vehicleName', 'msrp', 'disclaimer', 'expiration', 'discountSource'],
      custom: ['msrp', 'disclaimer'],
    },
    notes: 'Ported from ODT Monthly Offers oem_offer_rules. trim → vehicleName; APR-only keys dropped from lease/custom (see seed script).',
  },
  {
    make: 'Volkswagen',
    requiredFields: {
      lease: ['vin', 'stockNumber', 'msrp', 'disclaimer', 'expiration', 'leaseTerm'],
      apr: ['vin', 'stockNumber', 'msrp', 'disclaimer', 'expiration', 'aprTerm', 'financialInstitution', 'costPerThousand'],
      discount: ['vin', 'stockNumber', 'msrp', 'disclaimer', 'expiration', 'discountSource'],
      sales_price: ['vehicleName', 'vin', 'stockNumber', 'msrp', 'disclaimer', 'expiration'],
      custom: [],
    },
    notes: 'Ported from ODT Monthly Offers oem_offer_rules. trim → vehicleName; lease_due dropped from apr/sales_price (see seed script).',
  },
];

async function main() {
  for (const r of RULES) {
    const row = await prisma.adOemOfferRule.upsert({
      where: { make: r.make },
      create: { make: r.make, requiredFields: JSON.stringify(r.requiredFields), notes: r.notes },
      update: { requiredFields: JSON.stringify(r.requiredFields), notes: r.notes, isActive: true },
    });
    console.log(`upserted OEM rule: ${row.make}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
