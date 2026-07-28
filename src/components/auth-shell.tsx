/**
 * Shared chrome for the unauthenticated pages (login, forgot password, reset
 * password) — the drifting orb backdrop plus a centered content column.
 *
 * Styling lives in the `── AUTH PAGES ──` section of globals.css; the orbs are
 * three empty spans because each needs its own blur/blend/drift, which can't be
 * expressed as a single gradient layer without the whole wash visibly moving as
 * one rectangle.
 *
 * Presentational only — no hooks and no client directive, so it composes from
 * either side of a `'use client'` boundary.
 */
export function AuthShell({
  children,
  className = 'max-w-md',
}: {
  children: React.ReactNode;
  /** Width constraint for the content column. Login overrides it for 2-up. */
  className?: string;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-orbs" aria-hidden>
        <span className="auth-orb auth-orb-1" />
        <span className="auth-orb auth-orb-2" />
        <span className="auth-orb auth-orb-3" />
      </div>
      <div className={`auth-content mx-auto ${className}`}>{children}</div>
    </div>
  );
}

/** Google's four-colour "G". Inline so the button stays self-contained. */
export function GoogleMark({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
