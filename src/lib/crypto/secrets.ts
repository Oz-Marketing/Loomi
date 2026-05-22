function normalizeSecret(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const normalized = values.map((value) => normalizeSecret(value)).filter(Boolean);
  return Array.from(new Set(normalized));
}

export function configuredEspTokenSecrets(): string[] {
  return uniqueNonEmpty([process.env.ESP_TOKEN_SECRET]);
}

export function requireEspTokenSecrets(): string[] {
  const secrets = configuredEspTokenSecrets();
  if (secrets.length === 0) {
    throw new Error('ESP_TOKEN_SECRET is required for ESP token encryption');
  }
  return secrets;
}

export function configuredEspOAuthStateSecrets(): string[] {
  return uniqueNonEmpty([
    process.env.ESP_OAUTH_STATE_SECRET,
    process.env.ESP_TOKEN_SECRET,
  ]);
}

export function requireEspOAuthStateSecrets(): string[] {
  const secrets = configuredEspOAuthStateSecrets();
  if (secrets.length === 0) {
    throw new Error('ESP_OAUTH_STATE_SECRET or ESP_TOKEN_SECRET is required for OAuth state signing');
  }
  return secrets;
}
