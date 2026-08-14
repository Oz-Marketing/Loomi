// Differential test: the SQL fast path must return EXACTLY the same
// contacts as the JS engine the segment builder shows a preview with.
//
// This is the test that makes the fast path trustworthy. A translator
// that's merely "close" is worse than none at all — it would mean a
// segment previews as one set of people and syncs to Google as another,
// and nothing in the product would reveal the difference. So rather than
// asserting hand-computed expectations (which would just encode my
// assumptions twice), every case runs both engines over the same seeded
// data and asserts set equality.
//
// The seed data is deliberately nasty in the places translations
// usually break: NULLs vs empty strings, mixed case, leading/trailing
// whitespace, SQL wildcards (%, _) inside search values, tag case
// mismatches, contacts with no tags at all, and a fullName that has to
// be derived from firstName + lastName.
//
// Self-skips unless RUN_DB_TESTS=1, per the convention in
// vitest.config.ts.  Run with:  RUN_DB_TESTS=1 npm test
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { evaluateFilter } from '@/lib/smart-list-engine';
import {
  getFilterableFields,
  type FilterDefinition,
  type FilterOperator,
} from '@/lib/smart-list-types';
import { recomputeContactEventRollups } from '@/lib/contacts/event-rollups';
import { loadSegmentRefs, SegmentRefError } from './refs';
import { translateDefinitionToSql } from './sql-filter';
import { collectSegmentContactIds, countSegment } from './resolve';

const RUN = !!process.env.RUN_DB_TESTS;
const ACCOUNT = '__vitest_segments_resolve';

const fields = getFilterableFields([
  { key: 'deal_type', label: 'Deal Type', type: 'select', category: 'custom' },
]);

const day = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);
const daysAhead = (n: number) => new Date(Date.now() + n * day);

interface SeedRow {
  id: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null;
  tags?: string[];
  dateAdded?: Date | null;
  purchaseDate?: Date | null;
  nextServiceDate?: Date | null;
  lastServiceDate?: Date | null;
  customFields?: Record<string, string> | null;
  lastEmailDeliveredAt?: Date | null;
  lastEmailOpenedAt?: Date | null;
  lastEmailClickedAt?: Date | null;
  lastSmsAt?: Date | null;
  lastMessageAt?: Date | null;
  vehicleYear?: string | null;
  vehicleMileage?: string | null;
  /** Seeded as real ContactEvent rows, then rolled up — so the test
   *  exercises the aggregation, not just hand-written column values. */
  events?: Array<{ type: 'service' | 'sale'; daysAgo: number; amount: number | null }>;
  /** Names of static lists this contact belongs to. */
  lists?: string[];
}

const SEED: SeedRow[] = [
  // Ordinary rows.
  { id: 's01', email: 'ana@example.com', firstName: 'Ana', lastName: 'Reyes', city: 'Ogden', state: 'UT', tags: ['vip', 'service'], purchaseDate: daysAgo(10), nextServiceDate: daysAhead(5) },
  { id: 's02', email: 'bo@example.com', firstName: 'Bo', lastName: 'Smith', city: 'Provo', state: 'UT', tags: ['service'], purchaseDate: daysAgo(400), nextServiceDate: daysAgo(3) },
  { id: 's03', email: 'cy@example.com', firstName: 'Cy', lastName: 'Jones', city: 'Layton', state: 'ID', tags: [], purchaseDate: daysAgo(200) },
  // Case + whitespace traps.
  { id: 's04', email: 'DEE@Example.COM', firstName: '  Dee  ', lastName: 'O\'Neil', city: 'OGDEN', tags: ['VIP'] },
  // NULL vs empty string.
  { id: 's05', email: null, phone: '+15550001111', firstName: 'Eve', lastName: null, city: null, tags: ['lapsed'] },
  { id: 's06', email: 'fay@example.com', firstName: 'Fay', lastName: '', city: '', tags: ['lapsed', 'vip'] },
  // fullName must be DERIVED for these (column left null).
  { id: 's07', email: 'gus@example.com', firstName: 'Gus', lastName: 'Vance', fullName: null },
  // …and taken verbatim for this one, where it disagrees with the parts.
  { id: 's08', email: 'hal@example.com', firstName: 'Hal', lastName: 'Ward', fullName: 'Halbert Ward Jr' },
  // SQL wildcards inside real data.
  { id: 's09', email: 'ivy@example.com', firstName: 'Ivy', source: '50% off promo', city: 'St_George' },
  { id: 's10', email: 'jon@example.com', firstName: 'Jon', source: '50 percent off promo', city: 'StXGeorge' },
  // Dates at boundaries.
  { id: 's11', email: 'kim@example.com', firstName: 'Kim', nextServiceDate: new Date(), lastServiceDate: daysAgo(180) },
  { id: 's12', email: 'lee@example.com', firstName: 'Lee', nextServiceDate: daysAhead(30), lastServiceDate: daysAgo(181) },
  { id: 's13', email: 'moe@example.com', firstName: 'Moe', nextServiceDate: null, lastServiceDate: null },
  // Tag edge cases.
  { id: 's14', email: 'nia@example.com', firstName: 'Nia', tags: ['Service', 'VIP', 'loyalty'] },
  { id: 's15', email: 'oli@example.com', firstName: 'Oli', tags: ['vip'] },
  // Custom field (forces the scan strategy).
  { id: 's16', email: 'pam@example.com', firstName: 'Pam', customFields: { deal_type: 'Lease' } },
  { id: 's17', email: 'quy@example.com', firstName: 'Quy', customFields: { deal_type: 'Purchase' } },
  // Engagement rollups — recently engaged, long-lapsed, and never touched.
  { id: 's18', email: 'rae@example.com', firstName: 'Rae', lastEmailDeliveredAt: daysAgo(5), lastEmailOpenedAt: daysAgo(4), lastEmailClickedAt: daysAgo(3), lastMessageAt: daysAgo(5) },
  { id: 's19', email: 'sam@example.com', firstName: 'Sam', lastEmailDeliveredAt: daysAgo(400), lastEmailOpenedAt: daysAgo(390), lastMessageAt: daysAgo(400) },
  { id: 's20', email: 'tia@example.com', firstName: 'Tia', phone: '+15550002222', lastSmsAt: daysAgo(2), lastMessageAt: daysAgo(2) },
  // numeric_text: mileage/year as CRM exports actually deliver them.
  // The junk rows are the point — a bad cast raises and takes the whole
  // query down, and hex/exponent notation is where a naive "just use
  // Number()" rule silently disagrees with SQL.
  { id: 's21', email: 'uma@example.com', firstName: 'Uma', vehicleYear: '2019', vehicleMileage: '72500' },
  { id: 's22', email: 'vic@example.com', firstName: 'Vic', vehicleYear: '2022', vehicleMileage: '72,500' },
  { id: 's23', email: 'wes@example.com', firstName: 'Wes', vehicleYear: '2015', vehicleMileage: ' 85000 ' },
  { id: 's24', email: 'xia@example.com', firstName: 'Xia', vehicleYear: 'unknown', vehicleMileage: '12k' },
  { id: 's25', email: 'yan@example.com', firstName: 'Yan', vehicleYear: '1e3', vehicleMileage: '0x10' },
  { id: 's26', email: 'zed@example.com', firstName: 'Zed', vehicleYear: null, vehicleMileage: null },
  { id: 's27', email: 'abe@example.com', firstName: 'Abe', vehicleYear: '2021', vehicleMileage: '9500.5' },
  // Purchase / service history. Loyal servicer, one-and-done buyer,
  // bought-but-never-serviced, and a big spender.
  { id: 's28', email: 'ben@example.com', firstName: 'Ben', events: [
    { type: 'service', daysAgo: 20, amount: 320 },
    { type: 'service', daysAgo: 200, amount: 180 },
    { type: 'service', daysAgo: 500, amount: 95 },
  ] },
  { id: 's29', email: 'cleo@example.com', firstName: 'Cleo', events: [
    { type: 'sale', daysAgo: 800, amount: 28000 },
  ] },
  { id: 's30', email: 'dan@example.com', firstName: 'Dan', events: [
    { type: 'sale', daysAgo: 100, amount: 41000 },
    { type: 'service', daysAgo: 30, amount: 1200 },
  ] },
  // Deliberately no events — must roll up to zeroes, not nulls.
  { id: 's31', email: 'eli@example.com', firstName: 'Eli' },
  // List membership, incl. a contact on two lists and one on none.
  { id: 's32', email: 'fin@example.com', firstName: 'Fin', lists: ['VIP Buyers'] },
  { id: 's33', email: 'gia@example.com', firstName: 'Gia', lists: ['VIP Buyers', 'Do Not Target'] },
  { id: 's34', email: 'hui@example.com', firstName: 'Hui', lists: ['Do Not Target'] },
];

/** Static lists created for the membership cases. */
const LIST_NAMES = ['VIP Buyers', 'Do Not Target'];
const listIdByName = new Map<string, string>();

/** Create every seeded contact, its events, and the derived rollups. */
async function seedContacts(): Promise<void> {
  listIdByName.clear();
  for (const name of LIST_NAMES) {
    const list = await prisma.contactList.create({
      data: { accountKey: ACCOUNT, name },
      select: { id: true },
    });
    listIdByName.set(name, list.id);
  }

  for (const row of SEED) {
    const { id, tags, customFields, events, lists: _lists, ...rest } = row;
    const contact = await prisma.contact.create({
      data: {
        accountKey: ACCOUNT,
        source: rest.source ?? id, // keeps every row individually addressable
        ...rest,
        tags: tags ?? [],
        customFields: customFields ?? undefined,
        dateAdded: rest.dateAdded ?? daysAgo(30),
      },
      select: { id: true },
    });

    for (const name of row.lists ?? []) {
      await prisma.contactListMembership.create({
        data: { listId: listIdByName.get(name)!, contactId: contact.id },
      });
    }

    for (const [i, ev] of (events ?? []).entries()) {
      await prisma.contactEvent.create({
        data: {
          accountKey: ACCOUNT,
          contactId: contact.id,
          type: ev.type,
          eventDate: daysAgo(ev.daysAgo),
          amount: ev.amount,
          idempotencyKey: `__vitest:${id}:${i}`,
        },
      });
    }
  }

  // Derive the rollups the way production does, rather than seeding the
  // columns directly — that way the aggregation itself is under test.
  const all = await prisma.contact.findMany({
    where: { accountKey: ACCOUNT },
    select: { id: true },
  });
  await recomputeContactEventRollups(ACCOUNT, all.map((c) => c.id));
}

function def(
  conditions: Array<{ field: string; operator: string; value?: string; value2?: string }>,
  logic: 'AND' | 'OR' = 'AND',
): FilterDefinition {
  return {
    version: 1,
    logic: 'AND',
    groups: [
      {
        id: 'g',
        logic,
        conditions: conditions.map((c, i) => ({
          id: `c${i}`,
          field: c.field,
          operator: c.operator as FilterOperator,
          value: c.value ?? '',
          value2: c.value2,
        })),
      },
    ],
  };
}

describe.skipIf(!RUN)('segment resolution: SQL path == JS engine', () => {
  beforeAll(async () => {
    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactEvent.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contact.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactList.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.account.deleteMany({ where: { key: ACCOUNT } });
    await prisma.account.create({
      data: { key: ACCOUNT, dealer: 'Vitest Segments' },
    });
    await seedContacts();
  });

  afterAll(async () => {
    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactEvent.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contact.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactList.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.account.deleteMany({ where: { key: ACCOUNT } });
  });

  /** The reference answer: serialize every contact and run the same
   *  engine the builder's preview runs. */
  async function jsReference(definition: FilterDefinition): Promise<string[]> {
    const rows = await prisma.contact.findMany({
      where: { accountKey: ACCOUNT },
      select: CONTACT_SELECT,
    });
    const contacts = rows.map((row) => serializeContact(row));
    return evaluateFilter(contacts, definition, fields)
      .map((c) => c.id)
      .sort();
  }

  /** Field set including the seeded lists as options, mirroring
   *  resolveFilterFields on the server. */
  function fieldsWithLists() {
    return getFilterableFields(
      [{ key: 'deal_type', label: 'Deal Type', type: 'select', category: 'custom' }],
      [...listIdByName].map(([name, id]) => ({ id, name })),
    );
  }

  async function assertAgrees(label: string, definition: FilterDefinition) {
    const expected = await jsReference(definition);
    const actual = (await collectSegmentContactIds(ACCOUNT, definition, fields)).sort();
    expect(actual, label).toEqual(expected);
    // …and the count endpoint agrees with the id list it's meant to size.
    const counted = await countSegment(ACCOUNT, definition, fields);
    expect(counted.count, `${label} (count)`).toBe(expected.length);
  }

  const CASES: Array<[string, FilterDefinition]> = [
    ['text contains', def([{ field: 'city', operator: 'contains', value: 'ogd' }])],
    ['text contains is case-insensitive', def([{ field: 'city', operator: 'contains', value: 'OGDEN' }])],
    ['text contains trims the column', def([{ field: 'firstName', operator: 'equals', value: 'Dee' }])],
    ['text not_contains admits NULL rows', def([{ field: 'city', operator: 'not_contains', value: 'ogden' }])],
    ['text equals', def([{ field: 'state', operator: 'equals', value: 'ut' }])],
    ['text not_equals admits NULL rows', def([{ field: 'state', operator: 'not_equals', value: 'UT' }])],
    ['text is_empty treats NULL and "" alike', def([{ field: 'city', operator: 'is_empty' }])],
    ['text is_not_empty', def([{ field: 'city', operator: 'is_not_empty' }])],
    ['% is a literal, not a wildcard', def([{ field: 'source', operator: 'contains', value: '50%' }])],
    ['_ is a literal, not a wildcard', def([{ field: 'city', operator: 'contains', value: 'St_George' }])],
    ['derived fullName (column null)', def([{ field: 'fullName', operator: 'contains', value: 'Gus Vance' }])],
    ['explicit fullName wins over the parts', def([{ field: 'fullName', operator: 'contains', value: 'Halbert' }])],
    ['fullName equals derived value', def([{ field: 'fullName', operator: 'equals', value: 'Ana Reyes' }])],
    ['date before', def([{ field: 'purchaseDate', operator: 'before', value: daysAgo(100).toISOString() }])],
    ['date after', def([{ field: 'purchaseDate', operator: 'after', value: daysAgo(100).toISOString() }])],
    ['date between', def([{ field: 'purchaseDate', operator: 'between', value: daysAgo(500).toISOString(), value2: daysAgo(100).toISOString() }])],
    ['date overdue excludes today', def([{ field: 'nextServiceDate', operator: 'overdue' }])],
    ['date within_days', def([{ field: 'nextServiceDate', operator: 'within_days', value: '30' }])],
    ['date within_last_days', def([{ field: 'purchaseDate', operator: 'within_last_days', value: '30' }])],
    ['date more_than_days_ago', def([{ field: 'lastServiceDate', operator: 'more_than_days_ago', value: '180' }])],
    ['date is_empty', def([{ field: 'nextServiceDate', operator: 'is_empty' }])],
    ['date is_not_empty', def([{ field: 'nextServiceDate', operator: 'is_not_empty' }])],
    ['tags includes_any is case-insensitive', def([{ field: 'tags', operator: 'includes_any', value: 'VIP' }])],
    ['tags includes_any with several targets', def([{ field: 'tags', operator: 'includes_any', value: 'lapsed, loyalty' }])],
    ['tags includes_all', def([{ field: 'tags', operator: 'includes_all', value: 'vip, service' }])],
    ['tags excludes covers untagged contacts', def([{ field: 'tags', operator: 'excludes', value: 'vip' }])],
    ['tags is_empty', def([{ field: 'tags', operator: 'is_empty' }])],
    ['tags is_not_empty', def([{ field: 'tags', operator: 'is_not_empty' }])],
    ['AND across conditions', def([
      { field: 'state', operator: 'equals', value: 'UT' },
      { field: 'tags', operator: 'includes_any', value: 'service' },
    ])],
    ['OR across conditions', def([
      { field: 'city', operator: 'equals', value: 'Provo' },
      { field: 'tags', operator: 'includes_any', value: 'loyalty' },
    ], 'OR')],
    ['unsatisfiable condition matches nobody', def([{ field: 'city', operator: 'equals', value: 'Nowhere' }])],
    // ── Engagement rollups (previously untranslatable) ──
    ['hasOpenedEmail is_true', def([{ field: 'hasOpenedEmail', operator: 'is_true' }])],
    ['hasOpenedEmail is_false covers never-engaged', def([{ field: 'hasOpenedEmail', operator: 'is_false' }])],
    ['hasClickedEmail is_true', def([{ field: 'hasClickedEmail', operator: 'is_true' }])],
    ['hasReceivedSms is_true', def([{ field: 'hasReceivedSms', operator: 'is_true' }])],
    ['hasReceivedMessage is_false', def([{ field: 'hasReceivedMessage', operator: 'is_false' }])],
    ['opened in the last 30 days', def([{ field: 'lastEmailOpenedAt', operator: 'within_last_days', value: '30' }])],
    ['opened, but not in the last 180 days', def([{ field: 'lastEmailOpenedAt', operator: 'more_than_days_ago', value: '180' }])],
    ['lastMessageDate maps to its column', def([{ field: 'lastMessageDate', operator: 'within_last_days', value: '30' }])],
    ['never messaged (lastMessageDate is_empty)', def([{ field: 'lastMessageDate', operator: 'is_empty' }])],
    // ── numeric_text (vehicle year / mileage) ──
    ['mileage over 60,000', def([{ field: 'vehicleMileage', operator: 'num_gt', value: '60000' }])],
    ['mileage at most 20,000 skips junk values', def([{ field: 'vehicleMileage', operator: 'num_lte', value: '20000' }])],
    ['mileage between', def([{ field: 'vehicleMileage', operator: 'num_between', value: '70000', value2: '90000' }])],
    ['decimal mileage', def([{ field: 'vehicleMileage', operator: 'num_lt', value: '10000' }])],
    ['year between 2019 and 2022', def([{ field: 'vehicleYear', operator: 'num_between', value: '2019', value2: '2022' }])],
    ['year not equal', def([{ field: 'vehicleYear', operator: 'num_not_equals', value: '2019' }])],
    ['legacy text operator still works on year', def([{ field: 'vehicleYear', operator: 'contains', value: '201' }])],
    ['legacy equals still works on year', def([{ field: 'vehicleYear', operator: 'equals', value: '2022' }])],
    ['year is_empty', def([{ field: 'vehicleYear', operator: 'is_empty' }])],
    // ── Purchase / service history rollups ──
    ['2+ service visits', def([{ field: 'serviceVisitCount', operator: 'num_gte', value: '2' }])],
    ['never serviced rolls up to zero, not null', def([{ field: 'serviceVisitCount', operator: 'num_equals', value: '0' }])],
    ['lifetime spend over $1,500', def([{ field: 'lifetimeSpend', operator: 'num_gt', value: '1500' }])],
    ['lifetime spend between', def([{ field: 'lifetimeSpend', operator: 'num_between', value: '500', value2: '2000' }])],
    ['has bought at least one vehicle', def([{ field: 'saleCount', operator: 'num_gte', value: '1' }])],
    ['serviced in the last 60 days', def([{ field: 'lastServiceEventAt', operator: 'within_last_days', value: '60' }])],
    ['lapsed service (none in 365 days)', def([{ field: 'lastServiceEventAt', operator: 'more_than_days_ago', value: '365' }])],
    ['first serviced more than a year ago', def([{ field: 'firstServiceEventAt', operator: 'more_than_days_ago', value: '365' }])],
    ['bought but never serviced', def([
      { field: 'saleCount', operator: 'num_gte', value: '1' },
      { field: 'serviceVisitCount', operator: 'num_equals', value: '0' },
    ])],
    ['loyal servicer with recent visit', def([
      { field: 'serviceVisitCount', operator: 'num_gte', value: '2' },
      { field: 'lastServiceEventAt', operator: 'within_last_days', value: '365' },
    ])],
    ['engaged recently AND has an email', def([
      { field: 'lastEmailOpenedAt', operator: 'within_last_days', value: '30' },
      { field: 'email', operator: 'is_not_empty' },
    ])],
  ];

  for (const [label, definition] of CASES) {
    it(label, async () => {
      // Guard the premise: these must actually be taking the SQL path,
      // otherwise the test is comparing the JS engine against itself.
      expect(translateDefinitionToSql(definition, fields).where, `${label} should translate`).not.toBeNull();
      await assertAgrees(label, definition);
    });
  }

  it('list membership agrees, including exclusion', async () => {
    const f = fieldsWithLists();
    const vip = listIdByName.get('VIP Buyers')!;
    const dnt = listIdByName.get('Do Not Target')!;

    const cases: Array<[string, FilterDefinition]> = [
      ['on the VIP list', def([{ field: 'listIds', operator: 'includes_any', value: vip }])],
      ['on either list', def([{ field: 'listIds', operator: 'includes_any', value: `${vip},${dnt}` }])],
      ['on BOTH lists', def([{ field: 'listIds', operator: 'includes_all', value: `${vip},${dnt}` }])],
      // The ad-suppression shape: everyone on one list except another.
      ['VIP but NOT do-not-target', def([
        { field: 'listIds', operator: 'includes_any', value: vip },
        { field: 'listIds', operator: 'excludes', value: dnt },
      ])],
      ['on no list at all', def([{ field: 'listIds', operator: 'is_empty' }])],
      ['on some list', def([{ field: 'listIds', operator: 'is_not_empty' }])],
    ];

    for (const [label, definition] of cases) {
      expect(translateDefinitionToSql(definition, f).where, `${label} should translate`).not.toBeNull();
      const rows = await prisma.contact.findMany({
        where: { accountKey: ACCOUNT },
        select: CONTACT_SELECT,
      });
      const expected = evaluateFilter(rows.map(serializeContact), definition, f)
        .map((c) => c.id)
        .sort();
      const actual = (await collectSegmentContactIds(ACCOUNT, definition, f)).sort();
      expect(actual, label).toEqual(expected);
    }

    // Guard against a vacuous pass: the suppression case must actually
    // exclude somebody.
    const vipOnly = await countSegment(
      ACCOUNT,
      def([
        { field: 'listIds', operator: 'includes_any', value: vip },
        { field: 'listIds', operator: 'excludes', value: dnt },
      ]),
      f,
    );
    const vipAll = await countSegment(
      ACCOUNT,
      def([{ field: 'listIds', operator: 'includes_any', value: vip }]),
      f,
    );
    expect(vipAll.count).toBe(2);
    expect(vipOnly.count).toBe(1);
  });

  it('segment composition agrees, and expresses suppression', async () => {
    // Two saved segments to compose: a broad one and the cohort to
    // subtract from it.
    const utah = await prisma.audience.create({
      data: {
        name: '__vitest Utah',
        accountKey: ACCOUNT,
        filters: JSON.stringify(def([{ field: 'state', operator: 'equals', value: 'UT' }])),
      },
      select: { id: true },
    });
    const vips = await prisma.audience.create({
      data: {
        name: '__vitest VIPs',
        accountKey: ACCOUNT,
        filters: JSON.stringify(def([{ field: 'tags', operator: 'includes_any', value: 'vip' }])),
      },
      select: { id: true },
    });

    const f = getFilterableFields(null, null, [
      { id: utah.id, name: '__vitest Utah' },
      { id: vips.id, name: '__vitest VIPs' },
    ]);

    const cases: Array<[string, FilterDefinition]> = [
      ['in segment', def([{ field: 'segmentRef', operator: 'in_segment', value: utah.id }])],
      ['not in segment', def([{ field: 'segmentRef', operator: 'not_in_segment', value: utah.id }])],
      // The suppression shape this feature exists for.
      ['Utah minus VIPs', def([
        { field: 'segmentRef', operator: 'in_segment', value: utah.id },
        { field: 'segmentRef', operator: 'not_in_segment', value: vips.id },
      ])],
      ['composed with an inline condition', def([
        { field: 'segmentRef', operator: 'in_segment', value: vips.id },
        { field: 'email', operator: 'is_not_empty' },
      ])],
    ];

    for (const [label, definition] of cases) {
      const refs = await loadSegmentRefs(ACCOUNT, definition);
      expect(translateDefinitionToSql(definition, f, refs).where, `${label} translates`).not.toBeNull();

      const rows = await prisma.contact.findMany({
        where: { accountKey: ACCOUNT },
        select: CONTACT_SELECT,
      });
      const expected = evaluateFilter(rows.map(serializeContact), definition, f, refs)
        .map((c) => c.id)
        .sort();
      const actual = (await collectSegmentContactIds(ACCOUNT, definition, f)).sort();
      expect(actual, label).toEqual(expected);
    }

    // Not vacuous: subtracting VIPs must actually remove somebody.
    const all = await countSegment(ACCOUNT, def([{ field: 'segmentRef', operator: 'in_segment', value: utah.id }]), f);
    const minus = await countSegment(ACCOUNT, def([
      { field: 'segmentRef', operator: 'in_segment', value: utah.id },
      { field: 'segmentRef', operator: 'not_in_segment', value: vips.id },
    ]), f);
    expect(all.count).toBeGreaterThan(0);
    expect(minus.count).toBeLessThan(all.count);

    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
  });

  it('refuses a reference loop instead of hanging', async () => {
    const a = await prisma.audience.create({
      data: { name: '__vitest A', accountKey: ACCOUNT, filters: JSON.stringify(def([{ field: 'state', operator: 'equals', value: 'UT' }])) },
      select: { id: true },
    });
    const b = await prisma.audience.create({
      data: {
        name: '__vitest B',
        accountKey: ACCOUNT,
        filters: JSON.stringify(def([{ field: 'segmentRef', operator: 'in_segment', value: a.id }])),
      },
      select: { id: true },
    });
    // Close the loop: A now references B, which references A.
    await prisma.audience.update({
      where: { id: a.id },
      data: { filters: JSON.stringify(def([{ field: 'segmentRef', operator: 'in_segment', value: b.id }])) },
    });

    const definition = def([{ field: 'segmentRef', operator: 'in_segment', value: a.id }]);
    await expect(loadSegmentRefs(ACCOUNT, definition)).rejects.toThrow(SegmentRefError);
    await expect(countSegment(ACCOUNT, definition, fields)).rejects.toThrow(SegmentRefError);

    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
  });

  it('an unresolvable reference matches nobody rather than everybody', async () => {
    // Fail-closed: a reference to a deleted segment must not widen the
    // audience. The loader rejects it; the engine, handed no refs at
    // all, independently returns nothing.
    const definition = def([
      { field: 'segmentRef', operator: 'in_segment', value: 'seg_does_not_exist' },
    ]);
    await expect(loadSegmentRefs(ACCOUNT, definition)).rejects.toThrow(SegmentRefError);

    const rows = await prisma.contact.findMany({
      where: { accountKey: ACCOUNT },
      select: CONTACT_SELECT,
    });
    expect(evaluateFilter(rows.map(serializeContact), definition, fields)).toEqual([]);
    // …and `not_in_segment` against a missing reference must not match
    // everybody either.
    const negated = def([
      { field: 'segmentRef', operator: 'not_in_segment', value: 'seg_does_not_exist' },
    ]);
    expect(evaluateFilter(rows.map(serializeContact), negated, fields)).toEqual([]);
  });

  it('multi-group definitions agree', async () => {
    const definition: FilterDefinition = {
      version: 1,
      logic: 'OR',
      groups: [
        {
          id: 'g1',
          logic: 'AND',
          conditions: [
            { id: 'a', field: 'state', operator: 'equals', value: 'UT' },
            { id: 'b', field: 'tags', operator: 'includes_any', value: 'vip' },
          ],
        },
        {
          id: 'g2',
          logic: 'AND',
          conditions: [
            { id: 'c', field: 'nextServiceDate', operator: 'is_empty', value: '' },
          ],
        },
      ],
    };
    expect(translateDefinitionToSql(definition, fields).where).not.toBeNull();
    await assertAgrees('multi-group', definition);
  });
});

describe.skipIf(!RUN)('scan strategy', () => {
  beforeAll(async () => {
    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactEvent.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contact.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactList.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.account.deleteMany({ where: { key: ACCOUNT } });
    await prisma.account.create({ data: { key: ACCOUNT, dealer: 'Vitest Segments' } });
    await seedContacts();
  });

  afterAll(async () => {
    await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactEvent.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contact.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.contactList.deleteMany({ where: { accountKey: ACCOUNT } });
    await prisma.account.deleteMany({ where: { key: ACCOUNT } });
  });

  it('falls back to the scan for custom fields, and still resolves them', async () => {
    const definition = def([{ field: 'deal_type', operator: 'is_one_of', value: 'Lease' }]);
    expect(translateDefinitionToSql(definition, fields).where).toBeNull();

    const result = await countSegment(ACCOUNT, definition, fields);
    expect(result.strategy).toBe('scan');
    expect(result.untranslatable).toContain('deal_type');
    expect(result.count).toBe(1);
  });

  it('messaging fields now take the SQL path (they used to force a scan)', async () => {
    // Engagement was a read-time aggregate over EmailEvent/SmsEvent, so
    // any segment touching it fell back to a full-roster scan. It's a
    // denormalised column now — this asserts the fast path is actually
    // being taken, not just that the answer happens to be right.
    const definition = def([{ field: 'hasOpenedEmail', operator: 'is_true' }]);
    expect(translateDefinitionToSql(definition, fields).where).not.toBeNull();

    const result = await countSegment(ACCOUNT, definition, fields);
    expect(result.strategy).toBe('sql');
    expect(result.untranslatable).toEqual([]);
    // s18 (opened 4d ago) + s19 (opened 390d ago).
    expect(result.count).toBe(2);
  });

  it('a mixed definition falls back wholesale rather than translating half', async () => {
    const definition = def([
      { field: 'state', operator: 'equals', value: 'UT' },
      { field: 'deal_type', operator: 'is_one_of', value: 'Lease' },
    ]);
    const translation = translateDefinitionToSql(definition, fields);
    expect(translation.where).toBeNull();
    expect((await countSegment(ACCOUNT, definition, fields)).strategy).toBe('scan');
  });
});
