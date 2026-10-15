import { describe, expect, it } from 'vitest';
import { copyCustomValues, customValueKey, customValueProblems, parseCustomValues } from './custom-values';

const GROUP = {
  specials_url: { name: 'Specials URL', value: 'https://group.example.com/specials' },
  service_scheduler_url: { name: 'Service Scheduler URL', value: '' },
  storefront_image: { name: 'Storefront Image', value: 'https://cdn/x.png' },
};

describe('customValueKey', () => {
  it('turns a name into a merge-tag key', () => {
    expect(customValueKey('Specials URL')).toBe('specials_url');
    expect(customValueKey('  Trade-In & Value  ')).toBe('trade_in_and_value');
    expect(customValueKey('Café Hours')).toBe('cafe_hours');
  });
});

describe('parseCustomValues', () => {
  it('reads stored JSON, including older bare-string values', () => {
    expect(parseCustomValues('{"a":"x","b":{"name":"B","value":"y"}}')).toEqual({
      a: { name: 'a', value: 'x' },
      b: { name: 'B', value: 'y' },
    });
    expect(parseCustomValues('not json')).toEqual({});
    expect(parseCustomValues(null)).toEqual({});
  });
});

describe('customValueProblems', () => {
  it('catches a missing name and two values that are the same tag', () => {
    expect(
      customValueProblems({
        specials_url: { name: 'Specials URL', value: '' },
        'Specials URL': { name: 'Specials link', value: '' },
        x: { name: ' ', value: '' },
      }),
    ).toEqual({ 'Specials URL': 'Same tag as "Specials URL".', x: 'Give it a name.' });
  });
});

describe('copyCustomValues', () => {
  it('adds what the account lacks and leaves its own values alone by default', () => {
    const r = copyCustomValues(
      { specials_url: { name: 'Specials URL', value: 'https://store.example.com/specials' } },
      GROUP,
      ['specials_url', 'service_scheduler_url'],
      { overwrite: false, withValues: true },
    );
    expect(r.added).toEqual(['service_scheduler_url']);
    expect(r.kept).toEqual(['specials_url']);
    expect(r.next.specials_url.value).toBe('https://store.example.com/specials');
  });

  it('replaces when asked, keeping the account\'s own key spelling', () => {
    const r = copyCustomValues({ 'Specials URL': { name: 'Specials', value: 'old' } }, GROUP, ['specials_url'], {
      overwrite: true,
      withValues: true,
    });
    expect(r.replaced).toEqual(['Specials URL']);
    expect(r.next).toEqual({ 'Specials URL': { name: 'Specials', value: 'https://group.example.com/specials' } });
  });

  it('copies names only, never blanking a value an account already has', () => {
    const r = copyCustomValues({ specials_url: { name: 'Specials URL', value: 'mine' } }, GROUP, ['specials_url', 'service_scheduler_url'], {
      overwrite: true,
      withValues: false,
    });
    expect(r.next.specials_url.value).toBe('mine');
    expect(r.next.service_scheduler_url).toEqual({ name: 'Service Scheduler URL', value: '' });
  });

  it('never copies the storefront image, or a key the group does not have', () => {
    const r = copyCustomValues({}, GROUP, ['storefront_image', 'nope'], { overwrite: true, withValues: true });
    expect(r.next).toEqual({});
  });
});
