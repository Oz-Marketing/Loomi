/** Browser fallback when `crypto.randomUUID` isn't available (very old or sandboxed). */
export function randomUUID(): string {
  return `tmp_${Math.random().toString(36).slice(2)}`;
}
