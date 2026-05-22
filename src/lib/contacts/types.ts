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
  lastMessageDate: string;
  _accountKey?: string;
  _dealer?: string;
}
