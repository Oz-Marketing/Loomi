'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { AppLogo } from '@/components/app-logo';
import { AuthShell } from '@/components/auth-shell';

export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // The login form forwards whatever was already typed, so the user doesn't
  // re-enter it after clicking "Forgot password?".
  useEffect(() => {
    const prefill = (searchParams.get('email') || '').trim();
    if (prefill) setEmail(prefill);
  }, [searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Enter the email address on your account.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to send a reset link right now');
      }
      // The endpoint answers identically for known and unknown addresses (no
      // account enumeration), so the confirmation is deliberately non-committal.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send a reset link right now');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-card p-7 sm:p-8">
        <div className="mb-7 text-center">
          <h1 className="inline-flex justify-center">
            <AppLogo className="h-8 w-auto max-w-[190px] object-contain" />
          </h1>
          <h2 className="mt-5 text-xl font-semibold tracking-tight">
            {sent ? 'Check your email' : 'Reset your password'}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
            {sent
              ? 'If that address has a Loomi Studio account, a reset link is on its way. The link expires in one hour.'
              : 'Enter your email and we will send you a link to choose a new password.'}
          </p>
        </div>

        {error && (
          <div className="auth-alert mb-5" role="alert">
            {error}
          </div>
        )}

        {sent ? (
          <div className="space-y-5">
            <div className="auth-notice flex items-start gap-2.5">
              <EnvelopeIcon className="mt-px h-4 w-4 flex-shrink-0" />
              <span>
                Sent to <strong className="font-semibold">{email.trim()}</strong>
              </span>
            </div>
            <p className="text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
              Nothing after a few minutes? Check spam, or{' '}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="auth-link"
              >
                try a different address
              </button>
              .
            </p>
            <Link href="/login" className="auth-sso">
              <ArrowLeftIcon className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        ) : (
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

            <div className="pt-2">
              <button type="submit" disabled={submitting} className="auth-submit">
                {submitting ? 'Sending link...' : 'Send reset link'}
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
