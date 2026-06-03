// Anti-SSRF validation for the webhook node. The flow worker fetches an
// author-supplied URL server-side, so without this a flow could point at
// cloud metadata (169.254.169.254), localhost, or RFC1918 internal
// services and pivot off the worker's network identity.
//
// Dev/test escape hatch: set ALLOW_INSECURE_WEBHOOKS=true to skip the
// check (so local http://localhost webhooks work). Never set it in prod.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost'];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127) return true; // unspecified / loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('fe80')) return true; // link-local
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** True if `ip` is a loopback/private/reserved address (or unparseable,
 *  which we treat as unsafe). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

/** True if `hostname` is a literal we should never fetch (localhost, an
 *  internal TLD, or a literal private IP). Public hostnames pass here and
 *  are checked by DNS resolution in assertSafeWebhookUrl. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (net.isIP(h)) return isPrivateIp(h);
  return false;
}

/**
 * Throw WebhookUrlError unless `rawUrl` is a public http(s) endpoint:
 * supported scheme, non-internal hostname, and every resolved address is
 * public (defeats a public hostname pointing at an internal IP).
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  if (process.env.ALLOW_INSECURE_WEBHOOKS === 'true') return;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError('invalid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new WebhookUrlError(`unsupported scheme "${parsed.protocol}"`);
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new WebhookUrlError(`blocked internal host "${parsed.hostname}"`);
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new WebhookUrlError(`could not resolve "${parsed.hostname}"`);
  }
  if (addrs.length === 0) throw new WebhookUrlError(`no address for "${parsed.hostname}"`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new WebhookUrlError(`"${parsed.hostname}" resolves to a private address`);
    }
  }
}
