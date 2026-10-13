import { describe, expect, it } from 'vitest';
import { SendGridError } from './sendgrid';
import { TwilioError } from './twilio';
import {
  attemptsSoFar,
  classifySendFailure,
  classifyTwilioFailure,
  isRecipientAddressRefusal,
  MAX_ATTEMPTS,
  PreSendError,
  sanitizeDisplayName,
  temporaryFailureNote,
} from './send-failures';

function network(code: string) {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

describe('classifySendFailure (SendGrid)', () => {
  it('retries only what SendGrid provably did not take', () => {
    expect(classifySendFailure(new SendGridError('rate limited', 429))).toBe('retry');
    expect(classifySendFailure(new SendGridError('internal', 500))).toBe('retry');
    expect(classifySendFailure(new SendGridError('unavailable', 503))).toBe('retry');
    expect(classifySendFailure(network('ECONNREFUSED'))).toBe('retry');
    expect(classifySendFailure(network('ENOTFOUND'))).toBe('retry');
    expect(classifySendFailure(new PreSendError('template threw'))).toBe('retry');
  });

  it('never retries what might already have been accepted', () => {
    // Our own abort, and gateway errors that can follow an acceptance.
    expect(classifySendFailure(new SendGridError('timed out', 0))).toBe('ambiguous');
    expect(classifySendFailure(new SendGridError('bad gateway', 502))).toBe('ambiguous');
    expect(classifySendFailure(new SendGridError('gateway timeout', 504))).toBe('ambiguous');
    expect(classifySendFailure(network('ECONNRESET'))).toBe('ambiguous');
    expect(classifySendFailure(new Error('something odd'))).toBe('ambiguous');
  });

  it('pauses on a rejected key instead of failing recipients', () => {
    expect(classifySendFailure(new SendGridError('unauthorized', 401))).toBe('auth');
    expect(classifySendFailure(new SendGridError('forbidden', 403))).toBe('auth');
  });

  it('treats a per-message refusal as permanent', () => {
    expect(classifySendFailure(new SendGridError('invalid email', 400))).toBe('permanent');
    expect(classifySendFailure(new SendGridError('too large', 413))).toBe('permanent');
  });
});

describe('classifyTwilioFailure', () => {
  it('recognizes a carrier-level STOP', () => {
    expect(
      classifyTwilioFailure(new TwilioError('unsubscribed recipient', 400, 21610)),
    ).toBe('optout');
  });

  it('pauses on rejected credentials', () => {
    expect(classifyTwilioFailure(new TwilioError('auth', 401, 20003))).toBe('auth');
  });

  it('retries a 5xx it answered, not an ambiguous one', () => {
    expect(classifyTwilioFailure(new TwilioError('down', 503))).toBe('retry');
    expect(classifyTwilioFailure(new TwilioError('timed out', 0))).toBe('ambiguous');
    // OK response without a SID: Twilio may have taken it.
    expect(classifyTwilioFailure(new TwilioError('missing SID', 201))).toBe('ambiguous');
  });

  it('treats an invalid number as permanent', () => {
    expect(classifyTwilioFailure(new TwilioError('invalid To', 400, 21211))).toBe('permanent');
  });
});

describe('attempt tracking', () => {
  it('reads back the attempt count it wrote', () => {
    expect(attemptsSoFar(null)).toBe(0);
    expect(attemptsSoFar('Suppressed (bounce)')).toBe(0);
    expect(attemptsSoFar(temporaryFailureNote(3, 'SendGrid: 503'))).toBe(3);
    expect(temporaryFailureNote(2, 'x')).toBe(`Temporary failure (attempt 2 of ${MAX_ATTEMPTS}): x`);
  });
});

describe('sanitizeDisplayName', () => {
  it('removes characters SendGrid rejects in a display name', () => {
    expect(sanitizeDisplayName('Smith, John')).toBe('Smith John');
    expect(sanitizeDisplayName('A; B')).toBe('A B');
    expect(sanitizeDisplayName('"Quoted" <x>')).toBe('Quoted x');
  });

  it('omits an empty name rather than sending ""', () => {
    expect(sanitizeDisplayName('  ')).toBeUndefined();
    expect(sanitizeDisplayName(null)).toBeUndefined();
  });
});

describe('isRecipientAddressRefusal', () => {
  const refusal = (errors: { message: string; field?: string }[], status = 400) =>
    new SendGridError(errors[0].message, status, { errors });

  it('is a bad address when SendGrid pins the 400 on the to field', () => {
    expect(
      isRecipientAddressRefusal(
        refusal([{ message: 'Does not contain a valid address.', field: 'personalizations.0.to.0.email' }]),
      ),
    ).toBe(true);
  });

  it('is a bad address when the message says so without a field', () => {
    expect(
      isRecipientAddressRefusal(refusal([{ message: 'The to email does not contain a valid address.' }])),
    ).toBe(true);
  });

  it('never blames the recipient for a message-level 400', () => {
    // These fail identically for the whole audience; suppressing on them
    // would wipe out a list over a template problem.
    expect(
      isRecipientAddressRefusal(refusal([{ message: 'The content value must be a string at least one character in length.', field: 'content.0.value' }])),
    ).toBe(false);
    expect(
      isRecipientAddressRefusal(
        refusal([{ message: 'The from email does not contain a valid address.', field: 'from.email' }]),
      ),
    ).toBe(false);
  });

  it('ignores non-400s and non-SendGrid errors', () => {
    expect(
      isRecipientAddressRefusal(refusal([{ message: 'Does not contain a valid address.', field: 'personalizations.0.to.0.email' }], 500)),
    ).toBe(false);
    expect(isRecipientAddressRefusal(new Error('Does not contain a valid address.'))).toBe(false);
  });
});
