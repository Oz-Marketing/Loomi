import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Form } from '@prisma/client';

/**
 * The persistence half of ad-click capture: whatever click ids the route
 * validated land in their own FormSubmission columns — and a submission
 * without them still writes nulls, exactly as before.
 */

const create = vi.fn();
const formUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    formSubmission: { create: (...a: unknown[]) => create(...a) },
    form: { update: (...a: unknown[]) => formUpdate(...a) },
  },
}));
vi.mock('@/lib/services/loomi-flows', () => ({ enrollContactForFormSubmission: vi.fn() }));
vi.mock('@/lib/integrations/crm/dispatch', () => ({ enqueueFormSubmissionCrmLeads: vi.fn() }));
vi.mock('./notify', () => ({ sendLeadNotificationEmail: vi.fn() }));
vi.mock('@/lib/s3', () => ({ isS3Configured: () => false, uploadToS3: vi.fn() }));
vi.mock('./turnstile', () => ({
  TURNSTILE_RESPONSE_FIELD: 'cf-turnstile-response',
  isTurnstileConfigured: () => false,
  verifyTurnstileToken: vi.fn(),
}));

import { submitForm } from './submit';
import { emptyFormTemplate } from './types';

/** An anonymous-lead form (no email/phone field), so no Contact upsert runs. */
const FORM = {
  id: 'form_1',
  slug: 'trade-in',
  name: 'Trade-in',
  accountKey: 'acct_1',
  isTemplate: false,
  listId: null,
  leadSource: null,
  redirectUrl: null,
  successMessage: null,
  notificationEmail: null,
  schema: {
    ...emptyFormTemplate(),
    blocks: [{ id: 'message', type: 'field_textarea', props: { name: 'message' } }],
  },
} as unknown as Form;

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: 'sub_1' });
  formUpdate.mockReset().mockResolvedValue({});
});

describe('submitForm — ad-click ids', () => {
  it('stores each click id in its own column', async () => {
    await submitForm({
      form: FORM,
      rawData: { message: 'Hi' },
      context: { gclid: 'XYZ', gbraid: 'abc_123', wbraid: 'W1', fbclid: 'F1', msclkid: 'M1' },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      gclid: 'XYZ',
      gbraid: 'abc_123',
      wbraid: 'W1',
      fbclid: 'F1',
      msclkid: 'M1',
    });
  });

  it('writes nulls when the visit carried none, leaving UTMs as they were', async () => {
    await submitForm({
      form: FORM,
      rawData: { message: 'Hi' },
      context: { utmSource: 'google', utmCampaign: 'aug-trade' },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      utmSource: 'google',
      utmCampaign: 'aug-trade',
      gclid: null,
      gbraid: null,
      wbraid: null,
      fbclid: null,
      msclkid: null,
    });
  });
});
