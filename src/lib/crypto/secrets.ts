function normalizeSecret(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const normalized = values.map((value) => normalizeSecret(value)).filter(Boolean);
  return Array.from(new Set(normalized));
}

// Token encryption secret(s).
//
// Primary env var: TOKEN_ENCRYPTION_SECRET. ESP_TOKEN_SECRET is read
// as a fallback for backwards-compat during the env-var migration;
// remove the fallback after the prod env has been updated to the new
// name.
export function configuredTokenEncryptionSecrets(): string[] {
  return uniqueNonEmpty([
    process.env.TOKEN_ENCRYPTION_SECRET,
    process.env.ESP_TOKEN_SECRET,
  ]);
}

export function requireTokenEncryptionSecrets(): string[] {
  const secrets = configuredTokenEncryptionSecrets();
  if (secrets.length === 0) {
    throw new Error(
      'TOKEN_ENCRYPTION_SECRET (or legacy ESP_TOKEN_SECRET) is required for token encryption',
    );
  }
  return secrets;
}
