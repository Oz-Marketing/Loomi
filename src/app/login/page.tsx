'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getProviders, signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BoltIcon,
  ChartBarSquareIcon,
  EyeIcon,
  EyeSlashIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { AppLogo } from '@/components/app-logo';
import { AuthShell, GoogleMark } from '@/components/auth-shell';

/**
 * Validate a `?callbackUrl` against an open-redirect. Returns the URL to
 * navigate to, or null to fall back to the current host's root.
 *   - Relative paths ("/projects") are always allowed.
 *   - Absolute URLs are allowed only on a Loomi host (apex, any *.loomilm.com
 *     subdomain) or a local dev *.localhost host.
 */
function resolveSafeCallbackUrl(raw: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    const ok =
      host === 'loomilm.com' ||
      host.endsWith('.loomilm.com') ||
      host === 'localhost' ||
      host.endsWith('.localhost');
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * NextAuth funnels provider/callback failures back here as `?error=<code>`.
 * `OAuthNoAccount` / `OAuthUnverifiedEmail` are ours, returned by the `signIn`
 * callback in lib/auth.ts; the rest are NextAuth's own codes.
 */
function messageForAuthError(code: string | null): string {
  switch (code) {
    case null:
    case '':
      return '';
    case 'OAuthNoAccount':
      return 'That Google account is not set up in Loomi yet. Ask an admin to invite you, then sign in again.';
    case 'OAuthUnverifiedEmail':
      return 'Google could not confirm that email address. Verify it with Google, or sign in with your password.';
    case 'AccessDenied':
      return 'Access denied. Your account is not permitted to sign in.';
    case 'SessionRequired':
      return 'Please sign in to continue.';
    case 'CredentialsSignin':
      return 'Invalid email or password';
    default:
      return 'Something went wrong signing you in. Please try again.';
  }
}

const HIGHLIGHTS = [
  {
    icon: SparklesIcon,
    title: 'Build with Iris',
    body: 'Generate campaigns, ads, and landing pages with your brand already loaded.',
  },
  {
    icon: ChartBarSquareIcon,
    title: 'Reporting that rolls up',
    body: 'Every account, one scope switch away — spend, pacing, and performance.',
  },
  {
    icon: BoltIcon,
    title: 'Ship the whole funnel',
    body: 'Email, SMS, flows, forms, and sites in a single connected workspace.',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // null until the provider list resolves, so the SSO block doesn't flash in and
  // out on first paint.
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const fromInvite = (searchParams.get('email') || '').trim();
    if (fromInvite) setEmail(fromInvite);
    setError(messageForAuthError(searchParams.get('error')));
  }, [searchParams]);

  // Ask NextAuth which providers are actually registered rather than mirroring
  // the server's env vars into a NEXT_PUBLIC_ flag that could drift.
  useEffect(() => {
    let cancelled = false;
    getProviders()
      .then((providers) => {
        if (!cancelled) setGoogleEnabled(Boolean(providers?.google));
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const callbackUrl = useMemo(
    () => resolveSafeCallbackUrl(searchParams.get('callbackUrl')),
    [searchParams],
  );

  const forgotHref = useMemo(() => {
    const typed = email.trim();
    return typed ? `/forgot-password?email=${encodeURIComponent(typed)}` : '/forgot-password';
  }, [email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError('Invalid email or password');
      setLoading(false);
    } else {
      // Honor a same-site ?callbackUrl (e.g. the marketing site sends users to
      // the App surface). Cross-origin targets use a full navigation so the
      // session cookie (scoped to .loomilm.com in prod) carries over; relative
      // paths and unknown behavior fall back to the current host's root.
      if (callbackUrl && /^https?:\/\//.test(callbackUrl)) {
        window.location.assign(callbackUrl);
        return;
      }
      router.push(callbackUrl || '/');
      router.refresh();
    }
  };

  const handleGoogle = () => {
    setError('');
    setGoogleLoading(true);
    // Full redirect flow (no `redirect: false`) — the OAuth handshake has to
    // leave the page, and NextAuth brings failures back as ?error=<code>.
    void signIn('google', { callbackUrl: callbackUrl || '/' });
  };

  return (
    <AuthShell className="max-w-6xl">
      <div className="grid items-center gap-12 min-[960px]:grid-cols-[1.05fr_minmax(0,25rem)] min-[960px]:gap-12 xl:gap-16">
        {/* Brand column — desktop only. On mobile the card carries the logo, so
            duplicating the pitch above it would just push the form off-screen. */}
        <div className="hidden min-[960px]:block">
          <div className="animate-fade-in-up animate-stagger-1">
            <AppLogo className="h-9 w-auto max-w-[210px] object-contain" />
          </div>

          <div className="animate-fade-in-up animate-stagger-2 mt-9">
            <span className="auth-eyebrow">Marketing Operations Platform</span>
          </div>

          <h1 className="auth-hero-title animate-fade-in-up animate-stagger-3 mt-5">
            Every campaign,
            <br />
            <span className="auth-hero-accent">one workspace.</span>
          </h1>

          <p className="animate-fade-in-up animate-stagger-4 mt-5 max-w-lg text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
            Loomi Studio is where the work happens — creative, channels, and
            reporting for every account you manage, in one place.
          </p>

          <ul className="animate-fade-in-up animate-stagger-5 mt-10 space-y-5">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-3.5">
                <span className="auth-feature-icon">
                  <item.icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Sign-in column */}
        <div className="auth-card mx-auto w-full max-w-md p-7 sm:p-8">
          <div className="mb-7 text-center min-[960px]:text-left">
            <h1 className="inline-flex justify-center min-[960px]:hidden">
              <AppLogo className="h-8 w-auto max-w-[190px] object-contain" />
            </h1>
            <h2 className="mt-4 text-xl font-semibold tracking-tight min-[960px]:mt-0 min-[960px]:text-2xl">
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
              Sign in to your Loomi Studio account
            </p>
          </div>

          {error && (
            <div className="auth-alert mb-5" role="alert">
              {error}
            </div>
          )}

          {googleEnabled && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || loading}
                className="auth-sso"
              >
                <GoogleMark />
                {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
              </button>
              <div className="auth-divider my-5">or</div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[0.8125rem] font-semibold text-[var(--foreground)]"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="auth-input"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label
                  htmlFor="password"
                  className="block text-[0.8125rem] font-semibold text-[var(--foreground)]"
                >
                  Password
                </label>
                {/* prefetch={false}: the href is derived from the email field,
                    so it changes on EVERY keystroke. With Next's default
                    prefetch that means one RSC request per character typed,
                    each carrying a partial email address in the query string
                    (and into the access logs). Nothing here is worth
                    pre-warming — it's a link people click once. */}
                <Link href={forgotHref} prefetch={false} className="auth-link text-xs">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="auth-input pr-11"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Wrapped so the extra breathing room above the CTA survives the
                form's `space-y-4`, which out-specifies a plain margin utility. */}
            <div className="pt-2">
              <button type="submit" disabled={loading || googleLoading} className="auth-submit">
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
            Need an account? Loomi Studio access is granted by invite — ask your
            account lead or an admin.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
