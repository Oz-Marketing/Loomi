import { describe, it, expect } from 'vitest';
import { isQueryTimeout } from './resolve';

describe('isQueryTimeout', () => {
  it('recognizes a statement timeout as the pg driver adapter reports it', () => {
    // Shape captured from a real `SET statement_timeout` cancel.
    const err = Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '57014',
            originalMessage: 'canceling statement due to statement timeout',
            kind: 'postgres',
          },
        },
      },
    });
    expect(isQueryTimeout(err)).toBe(true);
  });

  it('recognizes an expired interactive transaction', () => {
    expect(isQueryTimeout({ code: 'P2028' })).toBe(true);
  });

  it('does not mistake other database errors for a timeout', () => {
    expect(isQueryTimeout({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42601' } } } })).toBe(false);
    expect(isQueryTimeout(new Error('connection refused'))).toBe(false);
    expect(isQueryTimeout(null)).toBe(false);
  });
});
