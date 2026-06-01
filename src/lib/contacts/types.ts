// Canonical Contact shape used by the filter engine, builder pages,
// dashboards, and contact UI. Mirrors the Prisma `Contact` model with
// a couple of API-only conveniences:
//
//   - `fullName` is derived (firstName + lastName) when the DB row
//     doesn't carry one explicitly; the API populates it on read.
//   - `tags` is a plain string[] here even though Prisma stores it as
//     jsonb — the API serialises consistently.
//   - messaging flags (`hasReceivedEmail` etc.) are materialised by
//     the API from EmailEvent / SmsEvent aggregates, not stored on
//     the contact row itself.
//   - `_accountKey` / `_dealer` are injected by aggregate / admin
//     views that flatten contacts across multiple sub-accounts; they
//     stay optional so single-account responses don't need them.
//   - `_accounts` carries the full list of sub-accounts a contact
//     appears in when the admin view deduplicates by email/phone.
//     One entry when the contact lives in a single sub-account;
//     multiple entries when the same email/phone exists across rooftops
//     (e.g. one customer who's shopped at multiple dealers). The
//     contacts-table renders this as an avatar stack with hover tooltips
//     for 2+ entries.

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  tags: string[];
  dateAdded: string;
  source: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleVin: string;
  vehicleMileage: string;
  lastServiceDate: string;
  nextServiceDate: string;
  leaseEndDate: string;
  warrantyEndDate: string;
  purchaseDate: string;
  hasReceivedMessage: boolean;
  hasReceivedEmail: boolean;
  hasReceivedSms: boolean;
  hasOpenedEmail: boolean;
  lastMessageDate: string;
  /** Account-extensible properties keyed by the custom field's `key`.
   *  Empty object when the contact has no custom data. Values are
   *  intentionally loose — the filter engine + UI normalise per the
   *  declared ContactCustomField type at consumption time. */
  customFields: Record<string, unknown>;
  _accountKey?: string;
  _dealer?: string;
  _accounts?: ContactAccountRef[];
}

/**
 * One sub-account reference attached to a deduplicated contact row in
 * admin/aggregate views. Carries just the fields the contacts-table's
 * avatar stack needs to render itself + populate its hover tooltip.
 */
export interface ContactAccountRef {
  key: string;
  dealer: string;
  storefrontImage?: string | null;
  /** Matches AccountAvatar's prop shape — see components/account-avatar.tsx. */
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
}
