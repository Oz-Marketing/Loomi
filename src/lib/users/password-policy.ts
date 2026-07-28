/**
 * One password rule for every place a user sets one — invite activation and
 * self-service reset both call this, so the two flows can't drift apart.
 */

const MIN_PASSWORD_LENGTH = 10;

export function normalizePassword(password: string): string {
  return password.trim();
}

/** Returns a user-facing error message, or null when the password is fine. */
export function validatePassword(password: string): string | null {
  if (normalizePassword(password).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export { MIN_PASSWORD_LENGTH };
