// DB-backed integration tests for landing-page canonical URL resolution.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// Requires DATABASE_URL. Creates rows under a unique key prefix and
// cascade-deletes them in afterAll.
//
// The pure URL-shape rules are covered in
// src/lib/landing-pages/canonical.test.ts. What needs a database is the
// LOOKUP those rules depend on: which AccountDomain row counts as
// canonical. Get that wrong and the LP's `rel=canonical`, its sitemap
// entry and the studio-host redirect all point somewhere real but wrong —
// a class of bug that typechecks perfectly and only shows up as a page
// quietly failing to rank.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { findCanonicalDomainForAccount } from './account-domains';
import { getPublishedLandingPageBySlug } from './landing-pages';

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_lpcanon_';
const acct = `${PREFIX}a`;
const bare = `${PREFIX}b`; // account with no domains at all

const SLUG = `${PREFIX}anniversary-sale`;
const HOME_SLUG = `${PREFIX}home`;

/** Minimal published LP. `schema` is validated on read, not here. */
async function makeLp(slug: string, accountKey: string) {
  return prisma.landingPage.create({
    data: {
      accountKey,
      name: `Vitest ${slug}`,
      slug,
      status: 'published',
      schema: { version: 1, settings: {}, blocks: [] },
    },
  });
}

async function makeDomain(opts: {
  accountKey: string;
  hostname: string;
  verifiedAt: Date | null;
  createdAt?: Date;
  homeLandingPageId?: string | null;
}) {
  return prisma.accountDomain.create({
    data: {
      accountKey: opts.accountKey,
      hostname: opts.hostname,
      verificationToken: 'vitest-token',
      verifiedAt: opts.verifiedAt,
      homeLandingPageId: opts.homeLandingPageId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

describe.skipIf(!RUN)('landing-page canonical URL — DB integration', () => {
  beforeAll(async () => {
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.accountDomain.deleteMany({ where: { hostname: { contains: 'vitest-lpcanon' } } });
    await prisma.account.createMany({
      data: [
        { key: acct, dealer: 'Vitest LP Canon A' },
        { key: bare, dealer: 'Vitest LP Canon B' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.accountDomain.deleteMany({ where: { hostname: { contains: 'vitest-lpcanon' } } });
  });

  beforeEach(async () => {
    await prisma.accountDomain.deleteMany({ where: { hostname: { contains: 'vitest-lpcanon' } } });
    await prisma.landingPage.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  });

  describe('findCanonicalDomainForAccount', () => {
    it('returns null when the account has no domains', async () => {
      expect(await findCanonicalDomainForAccount(bare)).toBeNull();
    });

    it('ignores an unverified domain', async () => {
      // An unverified hostname has no DNS pointing at us yet. Treating it as
      // canonical would aim every canonical tag and redirect at a dead host.
      await makeDomain({
        accountKey: acct,
        hostname: 'unverified.vitest-lpcanon.test',
        verifiedAt: null,
      });
      expect(await findCanonicalDomainForAccount(acct)).toBeNull();
    });

    it('picks the oldest verified domain when several exist', async () => {
      // Stability matters more than recency: if adding a second domain moved
      // the canonical URL, it would de-index every page on the first one.
      await makeDomain({
        accountKey: acct,
        hostname: 'second.vitest-lpcanon.test',
        verifiedAt: new Date('2026-03-01T00:00:00Z'),
        createdAt: new Date('2026-03-01T00:00:00Z'),
      });
      await makeDomain({
        accountKey: acct,
        hostname: 'first.vitest-lpcanon.test',
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const found = await findCanonicalDomainForAccount(acct);
      expect(found?.hostname).toBe('first.vitest-lpcanon.test');
    });

    it('skips an unverified older domain in favor of a verified newer one', async () => {
      await makeDomain({
        accountKey: acct,
        hostname: 'old-unverified.vitest-lpcanon.test',
        verifiedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      await makeDomain({
        accountKey: acct,
        hostname: 'new-verified.vitest-lpcanon.test',
        verifiedAt: new Date('2026-06-01T00:00:00Z'),
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });
      const found = await findCanonicalDomainForAccount(acct);
      expect(found?.hostname).toBe('new-verified.vitest-lpcanon.test');
    });

    it('does not leak another account’s domain', async () => {
      await makeDomain({
        accountKey: acct,
        hostname: 'owned.vitest-lpcanon.test',
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      });
      expect(await findCanonicalDomainForAccount(bare)).toBeNull();
    });
  });

  describe('publicUrl on a resolved landing page', () => {
    it('is the studio URL when the account has no verified domain', async () => {
      await makeLp(SLUG, bare);
      const page = await getPublishedLandingPageBySlug(SLUG);
      expect(page?.publicUrl).toContain(`/lp/${SLUG}`);
      expect(page?.publicUrl).not.toContain('vitest-lpcanon.test');
    });

    it('is the custom-domain URL once a domain is verified', async () => {
      await makeLp(SLUG, acct);
      await makeDomain({
        accountKey: acct,
        hostname: 'offers.vitest-lpcanon.test',
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const page = await getPublishedLandingPageBySlug(SLUG);
      expect(page?.publicUrl).toBe(`https://offers.vitest-lpcanon.test/${SLUG}`);
    });

    it('is the domain root for the LP configured as that domain’s home', async () => {
      const home = await makeLp(HOME_SLUG, acct);
      await makeDomain({
        accountKey: acct,
        hostname: 'anniversary.vitest-lpcanon.test',
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
        homeLandingPageId: home.id,
      });
      const page = await getPublishedLandingPageBySlug(HOME_SLUG);
      expect(page?.publicUrl).toBe('https://anniversary.vitest-lpcanon.test/');
    });

    it('gives a sibling LP its own path, not the home root', async () => {
      const home = await makeLp(HOME_SLUG, acct);
      await makeLp(SLUG, acct);
      await makeDomain({
        accountKey: acct,
        hostname: 'anniversary.vitest-lpcanon.test',
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
        homeLandingPageId: home.id,
      });
      const sibling = await getPublishedLandingPageBySlug(SLUG);
      expect(sibling?.publicUrl).toBe(`https://anniversary.vitest-lpcanon.test/${SLUG}`);
    });

    it('stays on the studio URL while the domain is still unverified', async () => {
      await makeLp(SLUG, acct);
      await makeDomain({
        accountKey: acct,
        hostname: 'pending.vitest-lpcanon.test',
        verifiedAt: null,
      });
      const page = await getPublishedLandingPageBySlug(SLUG);
      expect(page?.publicUrl).toContain(`/lp/${SLUG}`);
    });
  });
});
