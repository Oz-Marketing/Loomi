import { describe, it, expect } from 'vitest';
import { pathOffersAllAccounts, ALL_ACCOUNTS_PATHS } from './account-context';

/**
 * Which pages may be viewed in the all-accounts scope (docs/account-scope.md).
 *
 * Pinned because the failure is silent and ugly: a page that wrongly opts in
 * renders one client's data merged with another's, and nothing throws.
 */
describe('pathOffersAllAccounts', () => {
  it('accepts the pages that opted in, and their sub-paths', () => {
    for (const p of ALL_ACCOUNTS_PATHS) {
      expect(pathOffersAllAccounts(p)).toBe(true);
      expect(pathOffersAllAccounts(`${p}/anything`)).toBe(true);
      // A lookalike prefix is a different page; matching it would opt a page in
      // without anyone deciding to.
      expect(pathOffersAllAccounts(`${p}-archive`)).toBe(false);
    }
  });

  it('refuses the client-data pages', () => {
    // These aggregate by GROUP, never across unrelated clients. If one of these
    // ever returns true, an export can merge a dealer's customers with a law
    // firm's.
    for (const p of ['/contacts', '/contacts/lists', '/campaign-builder', '/templates', '/flows', '/media']) {
      expect(pathOffersAllAccounts(p), `${p} must not offer all-accounts`).toBe(false);
    }
  });

  it('refuses the retired Playbooks page', () => {
    expect(pathOffersAllAccounts('/playbooks')).toBe(false);
  });

  it('refuses the studio root', () => {
    expect(pathOffersAllAccounts('/')).toBe(false);
  });
});
