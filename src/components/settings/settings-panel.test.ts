import { describe, it, expect } from 'vitest';
import { SETTINGS_PANEL_KEYS } from './settings-panel';
import { SETTINGS_TAB_KEYS } from './settings-registry';

/**
 * The registry decides which tabs EXIST; settings-panel decides what each one
 * RENDERS. Both surfaces (the Settings page and the Agency Settings modal) read
 * the pair, so a key present in one and absent from the other is a rail row
 * above an empty panel — which is how Markup and Channels shipped invisible.
 *
 * `Record<SettingsTabKey, …>` already makes a missing panel a compile error.
 * This is the belt: it fails loudly if that type is ever widened to `string`,
 * and it catches the other direction, which the type can't.
 */
describe('every settings tab has a panel', () => {
  it('covers every registry key', () => {
    const missing = SETTINGS_TAB_KEYS.filter((k) => !SETTINGS_PANEL_KEYS.includes(k));
    expect(missing).toEqual([]);
  });

  it('has no panel for a tab that no longer exists', () => {
    const orphaned = SETTINGS_PANEL_KEYS.filter((k) => !SETTINGS_TAB_KEYS.includes(k));
    expect(orphaned).toEqual([]);
  });
});
