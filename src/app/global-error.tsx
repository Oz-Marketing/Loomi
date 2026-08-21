'use client';

/**
 * Last-resort boundary, for an error thrown by the ROOT LAYOUT itself.
 *
 * `error.tsx` renders inside the root layout, so it cannot catch a failure in
 * the layout that would contain it — that case replaces the entire document,
 * which is why this file has to supply its own `<html>` and `<body>`.
 *
 * That also means none of the app's chrome is available here: no Providers, no
 * ThemeProvider, no font variables, no globals.css guarantee. Every style below
 * is inline and every colour is literal, because the thing that would normally
 * define them is the thing that just failed. Reaching for a CSS variable or the
 * shared <AppLogo> here would risk a boundary that throws while reporting a
 * throw, and the user sees a blank page instead.
 *
 * `prefers-color-scheme` is handled by picking values that read acceptably on
 * either — a media query cannot run without a stylesheet.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0f',
          color: '#fafafa',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 1.5rem',
              borderRadius: 14,
              background: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            l
          </div>

          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Loomi couldn&rsquo;t start this page.
          </h1>

          <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, color: '#a1a1aa', margin: '0 0 1.75rem' }}>
            Something failed before the app finished loading. The error has been
            logged.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              appearance: 'none',
              border: 0,
              cursor: 'pointer',
              background: '#6366f1',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '0.7rem 1.15rem',
              borderRadius: 12,
            }}
          >
            Reload
          </button>

          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '1.75rem' }}>
              Reference{' '}
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {error.digest}
              </code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
