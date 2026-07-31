import { describe, it, expect } from 'vitest';
import {
  BUDGET_CHANNELS,
  budgetChannel,
  channelLabel,
  channelCategory,
  channelPacerPlatform,
  channelsForPlatform,
  isBudgetChannel,
  isPacedChannel,
  ADS_CHANNEL_OPTION_MAP,
  KIND_DEFAULT_CHANNEL,
} from './channels';
import { KIND_BUDGET_CHANNELS } from '@/lib/projects/ui';

describe('channel registry', () => {
  it('has unique keys', () => {
    const keys = BUDGET_CHANNELS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves known keys and rejects unknown ones', () => {
    expect(isBudgetChannel('meta')).toBe(true);
    expect(isBudgetChannel('tiktok')).toBe(false);
    expect(isBudgetChannel(null)).toBe(false);
    expect(isBudgetChannel('')).toBe(false);
    expect(budgetChannel('nope')).toBeNull();
  });

  it('labels an unassigned channel rather than returning a raw key', () => {
    expect(channelLabel('meta')).toBe('Meta');
    expect(channelLabel(null)).toBe('Unassigned');
    expect(channelCategory('radio')).toBe('Traditional');
    expect(channelCategory(null)).toBeNull();
  });
});

describe('pacer platform mapping', () => {
  it('maps both Google-family channels onto the google pacer', () => {
    // The pacer's grain is the Google campaign and YouTube/Demand Gen campaigns
    // live in the same customer account, so the budget's planning split of
    // google/youtube must collapse to ONE platform on the rollup.
    expect(channelPacerPlatform('google')).toBe('google');
    expect(channelPacerPlatform('youtube')).toBe('google');
    expect(channelsForPlatform('google').sort()).toEqual(['google', 'youtube']);
  });

  it('maps meta to its own platform', () => {
    expect(channelsForPlatform('meta')).toEqual(['meta']);
  });

  it('leaves non-digital channels unpaced', () => {
    // These have no platform to sync spend from, so they settle by hand —
    // getPacerBudgetGoals must never pick them up.
    for (const key of ['radio', 'tv', 'billboard', 'print', 'video', 'pr', 'ott', 'email_sms']) {
      expect(isPacedChannel(key)).toBe(false);
    }
  });
});

describe('intake mappings point at real channels', () => {
  it('every KIND_BUDGET_CHANNELS entry is a registered channel', () => {
    // The one way intake can silently drop a rep's money: offer an input for a
    // channel the server then rejects as unknown.
    for (const [kind, channels] of Object.entries(KIND_BUDGET_CHANNELS)) {
      for (const ch of channels) {
        expect(isBudgetChannel(ch), `${kind} → ${ch}`).toBe(true);
      }
    }
  });

  it('every ads-option and kind-default mapping resolves', () => {
    for (const ch of Object.values(ADS_CHANNEL_OPTION_MAP)) {
      expect(isBudgetChannel(ch), ch).toBe(true);
    }
    for (const ch of Object.values(KIND_DEFAULT_CHANNEL)) {
      expect(isBudgetChannel(ch), ch).toBe(true);
    }
  });
});
