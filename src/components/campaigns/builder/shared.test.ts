import { describe, it, expect } from 'vitest';
import { assetEditorPath } from './shared';

describe('assetEditorPath', () => {
  // A client's href builder prefixes the account slug.
  const clientHref = (p: string) => `/subaccount/young-honda${p}`;

  it('keeps channel assets inside the account prefix', () => {
    expect(assetEditorPath(clientHref, 'email', 'e1')).toBe('/subaccount/young-honda/messaging/blasts/e1/recipients');
    expect(assetEditorPath(clientHref, 'landingPage', 'l1')).toBe('/subaccount/young-honda/websites/landing-pages/l1');
  });

  it('sends an ad to the bare editor path — there is no account-prefixed ad route', () => {
    // The bug: this returned /subaccount/young-honda/ad-generator/a1, which
    // does not exist, so every client design link 404'd.
    expect(assetEditorPath(clientHref, 'ad', 'a1')).toBe('/ad-generator/a1');
  });
});
