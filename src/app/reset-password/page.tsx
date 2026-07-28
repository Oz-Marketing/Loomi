'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { AppLogo } from '@/components/app-logo';
import { AuthShell } from '@/components/auth-shell';
import { MIN_PASSWORD_LENGTH } from '@/lib/users/password-policy';

interface ResetPreview {
  user: { name: string; email: string };
  expiresAt: string;
}

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reset, setReset] = useState<ResetPreview | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Validate the token before showing the form, so a dead link fails
  // immediately rather than after the user picks a password.
  useEffect(() => {
    let cancelled = false;

    async function loadReset() {
      if (!token) {
        setError('This reset link is missing its token. Request a new one.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/password-reset/validate?token=${encodeURIComponent(token)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This reset link is invalid or has expired');
        if (!cancelled) setReset(data as ResetPreview);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'This reset link is invalid or has expired',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReset();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loginHref = useMemo(() => {
    if (!reset?.user.email) return '/login';
    return `/login?email=${encodeURIComponent(reset.user.email)}`;
  }, [reset?.user.email]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to reset your password');

      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset your password');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthShell>
        <div className="auth-card p-8 text-center text-sm text-[var(--muted-foreground)]">
          Checking your reset link...
        </div>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell>
        <div className="auth-card p-7 text-center sm:p-8">
          <h1 className="inline-flex justify-center">
            <AppLogo className="h-8 w-auto max-w-[190px] object-contain" />
          </h1>
          <CheckCircleIcon className="mx-auto mt-6 h-10 w-10 text-emerald-400" />
          <h2 className="mt-4 text-xl font-semibold tracking-tight">Password updated</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
            You can now sign in to Loomi Studio with your new password.
          </p>
          <div className="mt-7">
            <Link href={loginHref} className="auth-submit">
              Continue to sign in
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-card p-7 sm:p-8">
        <div className="mb-7 text-center">
          <h1 className="inline-flex justify-center">
            <AppLogo className="h-8 w-auto max-w-[190px] object-contain" />
          </h1>
          <h2 className="mt-5 text-xl font-semibold tracking-tight">Choose a new password</h2>
          {reset ? (
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {reset.user.name} ({reset.user.email})
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
              Reset links are single-use and expire after an hour.
            </p>
          )}
        </div>

        {error && (
          <div className="auth-alert mb-5" role="alert">
            {error}
          </div>
        )}

        {!reset ? (
          <div className="space-y-4">
            <Link href="/forgot-password" className="auth-submit">
              Request a new link
            </Link>
            <p className="text-center text-sm">
              <Link href="/login" className="auth-link">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[0.8125rem] font-semibold text-[var(--foreground)]"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoFocus
                  className="auth-input pr-11"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-[0.8125rem] font-semibold text-[var(--foreground)]"
              >
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="auth-input"
                placeholder="Re-enter password"
              />
            </div>

            <div className="pt-2">
              <button type="submit" disabled={submitting} className="auth-submit">
                {submitting ? 'Updating password...' : 'Update password'}
              </button>
            </div>

            <p className="pt-1 text-center text-sm">
              <Link href="/login" className="auth-link">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
