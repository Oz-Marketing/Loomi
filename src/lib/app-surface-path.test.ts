import { describe, it, expect } from 'vitest';
import { appSurfacePrefix, normalizeAppPath, appHref } from './app-surface-path';

/**
 * The two worlds this has to serve at once: production, where the App host's
 * proxy hides `/app`, and local dev, where there is no proxy and `/app` is the
 * only path that resolves.
 */
describe('appSurfacePrefix', () => {
  it('is empty behind the proxy, where paths are already bare', () => {
    for (const p of ['/projects', '/playbooks', '/tools/meta', '/settings']) {
      expect(appSurfacePrefix(p)).toBe('');
    }
  });

  it('is /app on the un-proxied path', () => {
    for (const p of ['/app', '/app/projects', '/app/playbooks', '/app/tools/meta']) {
      expect(appSurfacePrefix(p)).toBe('/app');
    }
  });

  it('does not treat a lookalike segment as the prefix', () => {
    // `/apps` and `/app-store` are not the App surface, and prefixing off them
    // would produce dead links that are painful to trace back to here.
    expect(appSurfacePrefix('/apps')).toBe('');
    expect(appSurfacePrefix('/app-store/thing')).toBe('');
    expect(appSurfacePrefix('/application')).toBe('');
  });
});

describe('normalizeAppPath', () => {
  it('strips the prefix so nav items can be declared bare', () => {
    expect(normalizeAppPath('/app/projects/tasks')).toBe('/projects/tasks');
    expect(normalizeAppPath('/app/playbooks')).toBe('/playbooks');
  });

  it('leaves an already-bare path alone', () => {
    expect(normalizeAppPath('/projects/tasks')).toBe('/projects/tasks');
  });

  it('maps the bare App root to /', () => {
    // Not '' -- an empty pathname makes every startsWith() comparison true.
    expect(normalizeAppPath('/app')).toBe('/');
  });
});

describe('appHref', () => {
  it('round-trips: an href built from a path normalizes back to itself', () => {
    for (const current of ['/projects', '/app/projects']) {
      const href = appHref(current, '/playbooks');
      expect(normalizeAppPath(href)).toBe('/playbooks');
    }
  });

  it('emits the form matching the current URL', () => {
    expect(appHref('/projects', '/playbooks')).toBe('/playbooks');
    expect(appHref('/app/projects', '/playbooks')).toBe('/app/playbooks');
  });
});
