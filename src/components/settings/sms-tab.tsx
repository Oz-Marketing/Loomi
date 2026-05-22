'use client';

// Twilio settings for a sub-account. Pattern mirrors the SendGrid
// section in the Sending tab: configured-state badge, password-style
// inputs for the credential pair, save / replace / remove actions, +
// a verify-connection button that pings Twilio's Account resource.
//
// We deliberately keep the From phone-number and Messaging Service SID
// fields cleartext — they're not secrets, and the server validates
// E.164 / MG-prefix shape on PUT.

import { useEffect, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  KeyIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface SmsTabProps {
  accountKey: string;
}

interface TwilioState {
  configured: boolean;
  phoneNumber: string | null;
  messagingServiceSid: string | null;
}

const sectionCardClass = 'glass-section-card rounded-xl p-6';
const labelClass = 'block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5';
const inputClass = 'w-full rounded-lg bg-[var(--input)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const helpTextClass = 'text-xs text-[var(--muted-foreground)] mt-1.5';

export function SmsTab({ accountKey }: SmsTabProps) {
  const [state, setState] = useState<TwilioState>({
    configured: false,
    phoneNumber: null,
    messagingServiceSid: null,
  });
  const [loading, setLoading] = useState(true);

  // Credential inputs are unsaved drafts — we never echo back the
  // stored values, only show whether they're configured.
  const [sidInput, setSidInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  // Cleartext fields are populated on load so the user can edit in place.
  const [phoneInput, setPhoneInput] = useState('');
  const [serviceSidInput, setServiceSidInput] = useState('');
  const [phoneDirty, setPhoneDirty] = useState(false);
  const [serviceDirty, setServiceDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    | { ok: boolean; error?: string; accountStatus?: string; friendlyName?: string }
    | null
  >(null);

  useEffect(() => {
    if (!accountKey) return;
    fetch(`/api/accounts/${accountKey}/twilio`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error || 'Failed to load Twilio config');
        return r.json() as Promise<TwilioState>;
      })
      .then((data) => {
        setState(data);
        setPhoneInput(data.phoneNumber || '');
        setServiceSidInput(data.messagingServiceSid || '');
        setPhoneDirty(false);
        setServiceDirty(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load Twilio config');
      })
      .finally(() => setLoading(false));
  }, [accountKey]);

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const body: Record<string, string> = {};
      if (sidInput.trim()) body.accountSid = sidInput.trim();
      if (tokenInput.trim()) body.authToken = tokenInput.trim();
      const res = await fetch(`/api/accounts/${accountKey}/twilio/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setVerifyResult({
        ok: Boolean(data.ok),
        error: data.error,
        accountStatus: data.accountStatus,
        friendlyName: data.friendlyName,
      });
    } catch (err) {
      setVerifyResult({ ok: false, error: err instanceof Error ? err.message : 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  }

  async function persist(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/twilio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setState({
        configured: Boolean(data.configured),
        phoneNumber: data.phoneNumber || null,
        messagingServiceSid: data.messagingServiceSid || null,
      });
      setPhoneInput(data.phoneNumber || '');
      setServiceSidInput(data.messagingServiceSid || '');
      setPhoneDirty(false);
      setServiceDirty(false);
      toast.success('Twilio settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCredentials() {
    const sid = sidInput.trim();
    const token = tokenInput.trim();
    if (!sid || !token) return;
    await persist({ accountSid: sid, authToken: token });
    setSidInput('');
    setTokenInput('');
    setVerifyResult(null);
  }

  async function handleRemoveCredentials() {
    if (!confirm('Remove Twilio credentials? Without them, SMS sends from this sub-account will fail until new credentials are provided.')) {
      return;
    }
    await persist({ accountSid: null, authToken: null });
    setVerifyResult(null);
  }

  async function handleSaveRouting() {
    // Send only the field(s) the user changed to keep the API call narrow.
    const payload: Record<string, unknown> = {};
    if (phoneDirty) payload.phoneNumber = phoneInput.trim() || null;
    if (serviceDirty) payload.messagingServiceSid = serviceSidInput.trim() || null;
    if (Object.keys(payload).length === 0) return;
    await persist(payload);
  }

  if (loading) {
    return (
      <div className="max-w-3xl">
        <div className={sectionCardClass}>
          <p className="text-sm text-[var(--muted-foreground)]">Loading Twilio config…</p>
        </div>
      </div>
    );
  }

  const routingDirty = phoneDirty || serviceDirty;
  const showAdvancedFields = state.configured || sidInput.trim().length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── Twilio credentials ── */}
      <section className={sectionCardClass}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <KeyIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-[var(--foreground)]">Twilio Credentials</h3>
              {state.configured ? (
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
              Required for SMS — this sub-account&apos;s campaigns send through Twilio directly.
              Without credentials, SMS sends will fail.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                {state.configured ? 'Replace Account SID' : 'Account SID'}
              </label>
              <input
                type="password"
                value={sidInput}
                onChange={(e) => {
                  setSidInput(e.target.value);
                  setVerifyResult(null);
                }}
                className={`${inputClass} font-mono`}
                placeholder="ACxxxxxxxxxxxxxxxx"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>
                {state.configured ? 'Replace Auth Token' : 'Auth Token'}
              </label>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setVerifyResult(null);
                }}
                className={`${inputClass} font-mono`}
                placeholder="32-character secret"
                autoComplete="off"
              />
            </div>
          </div>
          <p className={helpTextClass}>
            Find both in Twilio Console → Account → API keys &amp; tokens. Use a main
            account or a sub-account; both work the same way.
            {state.configured && ' Submitting new values replaces the saved pair.'}
          </p>

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
                    <p className="font-medium">Twilio accepted the credentials.</p>
                    {verifyResult.friendlyName && (
                      <p className="opacity-80">
                        Account: <span className="font-medium">{verifyResult.friendlyName}</span>
                        {verifyResult.accountStatus && ` (${verifyResult.accountStatus})`}
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
              onClick={handleVerify}
              disabled={verifying || saving || (!sidInput.trim() && !state.configured)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {verifying ? 'Verifying…' : 'Verify Connection'}
            </button>
            {sidInput.trim() && tokenInput.trim() && (
              <PrimaryButton onClick={handleSaveCredentials} disabled={saving}>
                {saving ? 'Saving…' : state.configured ? 'Replace Credentials' : 'Save Credentials'}
              </PrimaryButton>
            )}
            {state.configured && !sidInput.trim() && !tokenInput.trim() && (
              <button
                type="button"
                onClick={handleRemoveCredentials}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Remove Credentials
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Routing (phone number / messaging service) ── */}
      {showAdvancedFields && (
        <section className={sectionCardClass}>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--foreground)]">Sender</h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Where messages send from. Messaging Services handle A2P 10DLC compliance + sticky
                sender + automatic phone-number fallover and take precedence when both are set.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={labelClass}>Messaging Service SID</label>
              <input
                type="text"
                value={serviceSidInput}
                onChange={(e) => {
                  setServiceSidInput(e.target.value);
                  setServiceDirty(true);
                }}
                className={`${inputClass} font-mono`}
                placeholder="MGxxxxxxxxxxxxxxxx"
              />
              <p className={helpTextClass}>
                Recommended for production sending. Create one in Twilio Console → Messaging →
                Services and attach your A2P-registered phone numbers to it.
              </p>
            </div>

            <div>
              <label className={labelClass}>Phone Number</label>
              <input
                type="text"
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value);
                  setPhoneDirty(true);
                }}
                className={`${inputClass} font-mono`}
                placeholder="+12025551234"
              />
              <p className={helpTextClass}>
                Fallback when no Messaging Service SID is set. Must be in E.164 format (with
                leading + and country code).
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <PrimaryButton onClick={handleSaveRouting} disabled={!routingDirty || saving}>
              {saving ? 'Saving…' : 'Save sender'}
            </PrimaryButton>
          </div>
        </section>
      )}

      <section className={sectionCardClass}>
        <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
          A2P 10DLC compliance checklist
        </h3>
        <ul className="text-sm text-[var(--muted-foreground)] space-y-2 list-disc pl-5">
          <li>Register a Twilio Business Profile (Trust Hub) for the sending entity.</li>
          <li>Submit a Brand registration and a Campaign use case (Marketing / Transactional / etc.).</li>
          <li>Attach the campaign-approved phone numbers to a Messaging Service.</li>
          <li>Wait for carrier approval (typically 1–7 business days) before launching volume sends.</li>
          <li>Keep opt-in records and honour STOP keywords on the receiving end.</li>
        </ul>
      </section>
    </div>
  );
}
