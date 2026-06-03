import { describe, it, expect } from 'vitest';
import { applyMergetags } from './mergetags';

describe('applyMergetags', () => {
  const ctx = {
    firstName: 'Pat',
    vehicleMake: 'Toyota',
    last_purchase_date: '2025-01-10',
    empty: '',
  };

  it('substitutes known keys in subject + body', () => {
    expect(applyMergetags('Hi {{firstName}}, your {{vehicleMake}}', ctx)).toBe(
      'Hi Pat, your Toyota',
    );
  });

  it('substitutes custom-field (snake_case) keys', () => {
    expect(applyMergetags('Bought {{last_purchase_date}}', ctx)).toBe(
      'Bought 2025-01-10',
    );
  });

  it('leaves UNKNOWN keys intact so typos are visible', () => {
    expect(applyMergetags('Hi {{frstName}}', ctx)).toBe('Hi {{frstName}}');
  });

  it('renders a known-but-empty key as empty (not the token)', () => {
    expect(applyMergetags('x{{empty}}y', ctx)).toBe('xy');
  });

  it('handles whitespace inside the braces', () => {
    expect(applyMergetags('Hi {{ firstName }}', ctx)).toBe('Hi Pat');
  });

  it('returns empty string for empty input', () => {
    expect(applyMergetags('', ctx)).toBe('');
  });
});
