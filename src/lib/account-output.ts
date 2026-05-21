import { applyAccountOutputAliases } from '@/lib/account-field-aliases';

const JSON_ACCOUNT_FIELDS = ['oems', 'logos', 'branding', 'customValues'] as const;

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function normalizeAccountOutputPayload(payload: Record<string, unknown>): void {
  for (const field of JSON_ACCOUNT_FIELDS) {
    if (!(field in payload)) continue;
    payload[field] = tryParseJson(payload[field]);
  }
  // Surface a boolean for the SendGrid API key, never the ciphertext.
  // Existing settings + sending UIs branch on `sendgridConfigured`.
  if ('sendgridApiKey' in payload) {
    payload.sendgridConfigured = Boolean(payload.sendgridApiKey);
    delete payload.sendgridApiKey;
  }
  applyAccountOutputAliases(payload);
}
