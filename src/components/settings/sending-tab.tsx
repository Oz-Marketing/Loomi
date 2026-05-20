'use client';

import { useEffect, useState } from 'react';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface SendingTabProps {
  accountKey: string;
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

  useEffect(() => {
    if (!accountKey) return;
    fetch(`/api/accounts/${accountKey}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error || 'Failed to load account');
        return r.json();
      })
      .then((account: Record<string, unknown>) => {
        const next: SendingConfig = {
          senderEmail: (account.senderEmail as string) || '',
          senderName: (account.senderName as string) || '',
          sendingDomain: (account.sendingDomain as string) || '',
          replyToEmail: (account.replyToEmail as string) || '',
        };
        setConfig(next);
        setInitial(next);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load sending config');
      })
      .finally(() => setLoading(false));
  }, [accountKey]);

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
