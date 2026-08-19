import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Every page whose content changes with the roll-up choice must expose a way to
 * change it. The control used to live in the account switcher, so it was free —
 * now it is opt-in per page, which means a new roll-up-aware page can ship with
 * no way to reach the group's own numbers, and nothing would fail.
 *
 * A page satisfies this by any of:
 *   - `scoped` on its PageHeader,
 *   - rendering <AccountScopeToggle /> itself,
 *   - having its own in-page account filter (Contacts, Projects), which
 *     expresses self-vs-rollup more precisely than a two-state toggle.
 *
 * See docs/account-scope.md.
 */
const OWN_ACCOUNT_FILTER = [
  'src/app/contacts/page.tsx',
  'src/app/contacts/lists/page.tsx',
  'src/app/contacts/segments/page.tsx',
  'src/app/app/projects/_components/tasks-view.tsx',
  'src/app/app/projects/_components/calendar-view.tsx',
  // A router: it picks between two dashboards, each of which carries the toggle.
  'src/app/reporting/page.tsx',
];

const INFRASTRUCTURE = [
  'src/contexts/account-context.tsx',
  'src/components/account-switcher.tsx',
  'src/components/account-scope-toggle.tsx',
  'src/components/page-header.tsx',
];

function rollupConsumers(): string[] {
  const out = execSync(
    "grep -rl 'isRollup' src --include='*.tsx' || true",
    { encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
}

describe('roll-up scope coverage', () => {
  it('gives every roll-up-aware page a way to change the scope', () => {
    const missing: string[] = [];
    for (const file of rollupConsumers()) {
      if (INFRASTRUCTURE.includes(file) || OWN_ACCOUNT_FILTER.includes(file)) continue;
      const src = readFileSync(file, 'utf8');
      const hasControl =
        /<PageHeader\s[^>]*scoped|\n\s*scoped\n/.test(src) || src.includes('AccountScopeToggle');
      if (!hasControl) missing.push(file);
    }
    expect(
      missing,
      `these read isRollup but expose no way to change it:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('still finds the pages it is supposed to be checking', () => {
    // Guards the guard: if `isRollup` is ever renamed, the grep above returns
    // nothing and this suite would pass by checking zero files.
    expect(rollupConsumers().length).toBeGreaterThan(10);
  });
});
