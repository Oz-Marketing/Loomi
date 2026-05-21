'use client';

import { useEffect, useState } from 'react';
import { EnvelopeIcon, KeyIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface SendingTabProps {
  accountKey: string;
}

interface SendGridState {
  configured: boolean;
  fromDomain: string | null;
}

interface SendingConfig {
  senderEmail: string;
  senderName: string;
  sendingDomain: string;
  replyToEmail: string;
}

const empty: SendingConfig = {
  senderEmail: '',
  senderName: '',
  sendingDomain: '',
  replyToEmail: '',
};

const sectionCardClass = 'glass-section-card rounded-xl p-6';
const labelClass = 'block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5';
const inputClass = 'w-full rounded-lg bg-[var(--input)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const helpTextClass = 'text-xs text-[var(--muted-foreground)] mt-1.5';

function isValidEmail(value: string): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function SendingTab({ accountKey }: SendingTabProps) {
  const [config, setConfig] = useState<SendingConfig>(empty);
  const [initial, setInitial] = useState<SendingConfig>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── SendGrid section state ──
  // `configured` reflects what's persisted. `apiKeyInput` is the
  // unsaved input — we never echo back the saved key. `verifyResult`
  // holds the most recent "Verify Connection" outcome.
  const [sendgrid, setSendgrid] = useState<SendGridState>({ configured: false, fromDomain: null });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [sgSaving, setSgSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    | { ok: boolean; error?: string; scopesCount?: number; domain?: { domain: string; valid: boolean } | null }
    | null
  >(null);

  useEffect(() => {
    if (!accountKey) return;
    Promise.all([
      fetch(`/api/accounts/${accountKey}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error || 'Failed to load account');
        return r.json();
      }),
      fetch(`/api/accounts/${accountKey}/sendgrid`).then(async (r) => {
        if (!r.ok) return { configured: false, fromDomain: null };
        return r.json();
      }),
    ])
      .then(([account, sg]: [Record<string, unknown>, SendGridState]) => {
        const next: SendingConfig = {
          senderEmail: (account.senderEmail as string) || '',
          senderName: (account.senderName as string) || '',
          sendingDomain: (account.sendingDomain as string) || '',
          replyToEmail: (account.replyToEmail as string) || '',
        };
        setConfig(next);
        setInitial(next);
        setSendgrid({ configured: Boolean(sg.configured), fromDomain: sg.fromDomain || null });
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load sending config');
      })
      .finally(() => setLoading(false));
  }, [accountKey]);

  // ── SendGrid handlers ──

  async function handleVerifySendGrid() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const trimmed = apiKeyInput.trim();
      const body: Record<string, string> = {};
      if (trimmed) body.apiKey = trimmed;
      if (config.sendingDomain) body.fromDomain = config.sendingDomain;
      const res = await fetch(`/api/accounts/${accountKey}/sendgrid/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setVerifyResult({
        ok: Boolean(data.ok),
        error: data.error,
        scopesCount: Array.isArray(data.scopes) ? data.scopes.length : undefined,
        domain: data.domain || null,
      });
    } catch (err) {
      setVerifyResult({ ok: false, error: err instanceof Error ? err.message : 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  }

  async function handleSaveSendGridKey() {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setSgSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/sendgrid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: trimmed,
          fromDomain: config.sendingDomain || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save key');
      setSendgrid({ configured: true, fromDomain: data.fromDomain || null });
      setApiKeyInput('');
      setVerifyResult(null);
      toast.success('SendGrid API key saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSgSaving(false);
    }
  }

  async function handleRemoveSendGridKey() {
    if (!confirm('Remove the SendGrid API key? Sends will fall back to SMTP.')) return;
    setSgSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/sendgrid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to remove key');
      setSendgrid({ configured: false, fromDomain: data.fromDomain || null });
      setVerifyResult(null);
      toast.success('SendGrid API key removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove key');
    } finally {
      setSgSaving(false);
    }
  }

  const dirty = JSON.stringify(config) !== JSON.stringify(initial);
  const senderEmailInvalid = !isValidEmail(config.senderEmail);
  const replyToInvalid = !isValidEmail(config.replyToEmail);
  const canSave = dirty && !senderEmailInvalid && !replyToInvalid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || 'Failed to save');
      }
      setInitial(config);
      toast.success('Sending config saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl">
        <div className={sectionCardClass}>
          <p className="text-sm text-[var(--muted-foreground)]">Loading sending config…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <section className={sectionCardClass}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <EnvelopeIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">Sender Identity</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              The From address and reply-to used when Loomi sends email campaigns for this subaccount.
              When blank, sends fall back to the global default.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>From Email</label>
              <input
                type="email"
                value={config.senderEmail}
                onChange={(e) => setConfig({ ...config, senderEmail: e.target.value })}
                className={inputClass}
                placeholder="marketing@mktg.client.com"
              />
              <p className={helpTextClass}>
                Must be on a domain you control and have authenticated with SendGrid (DKIM/SPF).
              </p>
              {senderEmailInvalid && (
                <p className="text-xs text-red-400 mt-1.5">Enter a valid email address.</p>
              )}
            </div>
            <div>
              <label className={labelClass}>From Name</label>
              <input
                type="text"
                value={config.senderName}
                onChange={(e) => setConfig({ ...config, senderName: e.target.value })}
                className={inputClass}
                placeholder="Young Powersports"
              />
              <p className={helpTextClass}>Shown to recipients as the sender name.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Sending Domain</label>
              <input
                type="text"
                value={config.sendingDomain}
                onChange={(e) => setConfig({ ...config, sendingDomain: e.target.value })}
                className={inputClass}
                placeholder="mktg.client.com"
              />
              <p className={helpTextClass}>
                The subdomain authenticated with the sending provider. Used for SPF / DKIM lookups.
              </p>
            </div>
            <div>
              <label className={labelClass}>Reply-To</label>
              <input
                type="email"
                value={config.replyToEmail}
                onChange={(e) => setConfig({ ...config, replyToEmail: e.target.value })}
                className={inputClass}
                placeholder="hello@client.com"
              />
              <p className={helpTextClass}>Optional. Where replies should land.</p>
              {replyToInvalid && (
                <p className="text-xs text-red-400 mt-1.5">Enter a valid email address.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <PrimaryButton onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </section>

      <section className={sectionCardClass}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <KeyIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-[var(--foreground)]">SendGrid API Key</h3>
              {sendgrid.configured ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400">
                  <CheckCircleIcon className="w-3 h-3" /> Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-500/10 text-zinc-400">
                  Not configured
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Optional — when set, this sub-account&apos;s campaigns send through SendGrid. Leave blank
              to fall back to the global SMTP transport.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>
              {sendgrid.configured ? 'Replace API Key' : 'API Key'}
            </label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => {
                setApiKeyInput(e.target.value);
                setVerifyResult(null);
              }}
              className={`${inputClass} font-mono`}
              placeholder="SG.xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
            <p className={helpTextClass}>
              Create a key in SendGrid → Settings → API Keys with at least <code>mail.send</code> permission.
              {sendgrid.configured && ' Submitting a new key here replaces the saved one.'}
            </p>
          </div>

          {verifyResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
                verifyResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/5 text-red-300'
              }`}
            >
              {verifyResult.ok ? (
                <CheckCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                {verifyResult.ok ? (
                  <>
                    <p className="font-medium">SendGrid accepted the key.</p>
                    {typeof verifyResult.scopesCount === 'number' && (
                      <p className="opacity-80">
                        {verifyResult.scopesCount} scope{verifyResult.scopesCount === 1 ? '' : 's'} available.
                      </p>
                    )}
                    {verifyResult.domain && (
                      <p className="opacity-80 mt-0.5">
                        Domain <code className="font-mono">{verifyResult.domain.domain}</code>:{' '}
                        {verifyResult.domain.valid ? (
                          <span className="text-emerald-300">Authenticated</span>
                        ) : (
                          <span className="text-amber-300">Pending — finish DKIM/SPF setup in SendGrid.</span>
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <p>{verifyResult.error || 'Verification failed.'}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleVerifySendGrid}
              disabled={verifying || sgSaving || (!apiKeyInput.trim() && !sendgrid.configured)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {verifying ? 'Verifying…' : 'Verify Connection'}
            </button>
            {apiKeyInput.trim() && (
              <PrimaryButton onClick={handleSaveSendGridKey} disabled={sgSaving}>
                {sgSaving ? 'Saving…' : sendgrid.configured ? 'Replace Key' : 'Save Key'}
              </PrimaryButton>
            )}
            {sendgrid.configured && !apiKeyInput.trim() && (
              <button
                type="button"
                onClick={handleRemoveSendGridKey}
                disabled={sgSaving}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Remove Key
              </button>
            )}
          </div>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
          Deliverability checklist
        </h3>
        <ul className="text-sm text-[var(--muted-foreground)] space-y-2 list-disc pl-5">
          <li>Add SendGrid&apos;s DKIM CNAMEs to the sending domain&apos;s DNS.</li>
          <li>Include <code className="text-xs bg-[var(--muted)] px-1 py-0.5 rounded">include:sendgrid.net</code> in the domain&apos;s SPF record.</li>
          <li>Publish a DMARC record (<code className="text-xs bg-[var(--muted)] px-1 py-0.5 rounded">p=none</code> to start, tighten after a clean week).</li>
          <li>Warm up volume gradually for the first 1–2 weeks of sends from a new domain.</li>
        </ul>
      </section>
    </div>
  );
}
