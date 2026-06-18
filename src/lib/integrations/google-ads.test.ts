import { describe, it, expect } from 'vitest';
import { microsToUnits, classifyOfflineConversion } from './google-ads';
import { applyGoogleMargins } from '@/lib/reporting/margins';

/**
 * Parity-critical pure helpers for the Google Ads port: micros conversion and
 * the offline-conversion classification (type+category → bucket). Mirrors Oz
 * Dealer Tools' GoogleAds::classifyOfflineConversion (enum-name form for REST).
 */

describe('microsToUnits', () => {
  it('divides micros by 1,000,000', () => {
    expect(microsToUnits('1500000')).toBe(1.5); // $1.50 avg_cpc
    expect(microsToUnits(3_100_170_000)).toBe(3100.17);
    expect(microsToUnits(undefined)).toBe(0);
    expect(microsToUnits('0')).toBe(0);
  });
});

describe('classifyOfflineConversion (Oz parity)', () => {
  it('buckets offline-upload types by category', () => {
    expect(classifyOfflineConversion('UPLOAD_CLICKS', 'LEAD')).toBe('offline_lead');
    expect(classifyOfflineConversion('UPLOAD_CALLS', 'PHONE_CALL_LEAD')).toBe('offline_lead');
    expect(classifyOfflineConversion('SALESFORCE', 'QUALIFIED_LEAD')).toBe('offline_lead');
    expect(classifyOfflineConversion('UPLOAD_CLICKS', 'PURCHASE')).toBe('offline_purchase');
    expect(classifyOfflineConversion('UPLOAD_CLICKS', 'STORE_SALE')).toBe('offline_purchase');
    // CONVERTED_LEAD is treated as a purchase (the lead became a sale).
    expect(classifyOfflineConversion('UPLOAD_CLICKS', 'CONVERTED_LEAD')).toBe('offline_purchase');
  });

  it('returns null for non-offline-upload types', () => {
    expect(classifyOfflineConversion('WEBPAGE', 'PURCHASE')).toBeNull();
    expect(classifyOfflineConversion('AD_CALL', 'LEAD')).toBeNull();
    expect(classifyOfflineConversion(undefined, 'LEAD')).toBeNull();
  });

  it('returns null for offline uploads whose category does not map', () => {
    expect(classifyOfflineConversion('UPLOAD_CLICKS', 'PAGE_VIEW')).toBeNull();
    expect(classifyOfflineConversion('UPLOAD_CLICKS', undefined)).toBeNull();
  });
});

describe('applyGoogleMargins on a Google metrics row', () => {
  it('grosses up cost / avg_cpc / cost_per_conversion, preserves actuals', () => {
    const out = applyGoogleMargins({ cost: 100, avg_cpc: 2.5, cost_per_conversion: 40, impressions: 5000 }, 23);
    expect(out.cost).toBe(129.87012987012986);
    expect(out.avg_cpc).toBe(3.2467532467532467);
    expect(out.cost_per_conversion).toBe(51.94805194805195);
    expect(out.actual_cost).toBe(100);
    expect(out.impressions).toBe(5000); // untouched
  });
});
