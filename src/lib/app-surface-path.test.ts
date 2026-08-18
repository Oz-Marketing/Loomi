import { describe, it, expect } from 'vitest';
import { appSurfacePrefix, normalizeAppPath, appHref } from './app-surface-path';

/**
 * The two worlds this has to serve at once: production, where the App host's
 * proxy hides `/app`, and local dev, where there is no proxy and `/app` is the
 * only path that resolves.
 */
describe('appSurfacePrefix', () => {
  it('is empty behind the proxy, where paths are already bare', () => {
    for (const p of ['/projects', '/projects/tasks', '/tools/meta', '/settings']) {
      expect(appSurfacePrefix(p)).toBe('');
    }
  });

  it('is /app on the un-proxied path', () => {
    for (const p of ['/app', '/app/projects', '/app/projects/tasks', '/app/tools/meta']) {
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
    expect(normalizeAppPath('/app/tools/meta')).toBe('/tools/meta');
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
      const href = appHref(current, '/projects/budget');
      expect(normalizeAppPath(href)).toBe('/projects/budget');
    }
  });

  it('emits the form matching the current URL', () => {
    expect(appHref('/projects', '/projects/budget')).toBe('/projects/budget');
    expect(appHref('/app/projects', '/projects/budget')).toBe('/app/projects/budget');
  });
});
