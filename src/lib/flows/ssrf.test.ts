import { describe, it, expect } from 'vitest';
import { isPrivateIp, isBlockedHostname } from './ssrf';

describe('isPrivateIp', () => {
  it('flags loopback, RFC1918, link-local/metadata, CGNAT', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('flags IPv6 loopback / ULA / link-local / mapped-private', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.72.110', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
  it('treats unparseable as unsafe', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('blocks localhost + internal TLDs', () => {
    for (const h of ['localhost', 'LOCALHOST', 'db.internal', 'api.local', 'x.localhost', 'foo.internal.']) {
      expect(isBlockedHostname(h)).toBe(true);
    }
  });
  it('blocks literal private IPs as hostnames', () => {
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
  });
  it('allows public hostnames (DNS check happens separately)', () => {
    expect(isBlockedHostname('hooks.zapier.com')).toBe(false);
    expect(isBlockedHostname('example.com')).toBe(false);
  });
});
