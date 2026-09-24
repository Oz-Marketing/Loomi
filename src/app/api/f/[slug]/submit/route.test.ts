import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The public submit endpoint's half of ad-click capture: the hidden
 * `__loomi_click_*` fields are pulled out of the payload, re-validated
 * (the endpoint is CORS-open — anyone can POST anything), and handed to
 * the pipeline as context, never as submission data.
 */

const findUnique = vi.fn();
const submitForm = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { form: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
vi.mock('@/lib/forms/rate-limit', () => ({ checkRateLimit: () => ({ ok: true }) }));
vi.mock('@/lib/forms/submit', () => ({
  submitForm: (...a: unknown[]) => submitForm(...a),
  FormSubmitError: class FormSubmitError extends Error {},
}));

import { POST } from './route';

type SubmitArgs = { rawData: Record<string, unknown>; context: Record<string, unknown> };

async function post(fields: Record<string, string>): Promise<SubmitArgs> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const req = new NextRequest('https://studio.loomilm.com/api/f/trade-in/submit', {
    method: 'POST',
    body,
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  const res = await POST(req, { params: Promise.resolve({ slug: 'trade-in' }) });
  expect(res.status).toBe(200);
  return submitForm.mock.calls[0][0] as SubmitArgs;
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ id: 'form_1', slug: 'trade-in', isTemplate: false });
  submitForm.mockReset().mockResolvedValue({
    submissionId: 'sub_1',
    contactId: null,
    redirectUrl: null,
    successMessage: null,
  });
});

describe('POST /api/f/[slug]/submit — ad-click ids', () => {
  it('passes a valid gbraid through as context', async () => {
    const { context } = await post({ message: 'Hi', __loomi_click_gbraid: 'abc_123' });
    expect(context.gbraid).toBe('abc_123');
  });

  it('passes all five ids, and strips them from the submission data', async () => {
    const { context, rawData } = await post({
      message: 'Hi',
      __loomi_click_gclid: 'XYZ',
      __loomi_click_gbraid: 'abc_123',
      __loomi_click_wbraid: 'W1',
      __loomi_click_fbclid: 'IwAR0',
      __loomi_click_msclkid: 'M1',
    });
    expect(context).toMatchObject({
      gclid: 'XYZ',
      gbraid: 'abc_123',
      wbraid: 'W1',
      fbclid: 'IwAR0',
      msclkid: 'M1',
    });
    expect(rawData).toEqual({ message: 'Hi' });
  });

  it('rejects invalid characters server-side', async () => {
    const { context, rawData } = await post({
      message: 'Hi',
      __loomi_click_gclid: 'XYZ<script>alert(1)</script>',
      __loomi_click_wbraid: 'a'.repeat(257),
      __loomi_click_fbclid: 'has space',
      __loomi_click_unknown: 'x',
    });
    expect(context.gclid).toBeUndefined();
    expect(context.wbraid).toBeUndefined();
    expect(context.fbclid).toBeUndefined();
    // Even the unknown one is kept out of the stored data.
    expect(rawData).toEqual({ message: 'Hi' });
  });

  it('leaves UTM, LP and metadata handling as it was', async () => {
    const { context, rawData } = await post({
      message: 'Hi',
      __loomi_utm_source: 'google',
      __loomi_utm_campaign: 'aug-trade',
      __loomi_lp_id: 'lp_1',
      __loomi_lp_slug: 'trade-event',
      __loomi_meta_vin: '1FT123',
      __loomi_click_gclid: 'XYZ',
    });
    expect(context).toMatchObject({
      utmSource: 'google',
      utmCampaign: 'aug-trade',
      lpId: 'lp_1',
      lpSlug: 'trade-event',
      metadata: { vin: '1FT123' },
      gclid: 'XYZ',
    });
    expect(rawData).toEqual({ message: 'Hi' });
  });
});
