'use client';

// Per-account styling for the CAN-SPAM footer appended to every blast and
// flow email.
//
// WHAT THIS DELIBERATELY DOES NOT DO: let anyone author the footer's HTML.
// The dealer name, postal address, and unsubscribe link are emitted by
// buildUnsubscribeFooter() and cannot be configured away, so no combination
// of settings on this page can ship a non-compliant email. A free-text HTML
// box here would be one paste away from the exact bug this area exists to
// prevent (see the module header in lib/sending/unsubscribe-footer.ts).
//
// The preview is the real renderer, not a mock-up — the same function the
// worker calls, running on the client. Before this page existed there was no
// way to see the footer at all: it was assembled at send time and never
// appeared in the template editor's preview.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { HelpTip } from '@/components/ui/help-tip';
import { useAccount } from '@/contexts/account-context';
import {
  buildUnsubscribeFooter,
  DEFAULT_FOOTER_CONFIG,
  resolveFooterConfig,
  UNSUBSCRIBE_TOKEN,
  type FooterAlign,
  type UnsubscribeFooterConfig,
} from '@/lib/sending/unsubscribe-footer';

interface EmailFooterTabProps {
  accountKey: string;
}

/** Web-safe stacks only — an email client won't load a webfont here. */
const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'Helvetica / Arial', value: 'Helvetica,Arial,sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia,Times New Roman,serif' },
  { label: 'Times New Roman', value: 'Times New Roman,Times,serif' },
  { label: 'Verdana', value: 'Verdana,Geneva,sans-serif' },
  { label: 'Tahoma', value: 'Tahoma,Geneva,sans-serif' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS,Helvetica,sans-serif' },
  { label: 'Courier New (mono)', value: 'Courier New,Courier,monospace' },
];

const ALIGNS: FooterAlign[] = ['left', 'center', 'right'];

const labelClass =
  'flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5';
const inputClass =
  'w-full rounded-lg bg-[var(--input)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const sectionCardClass = 'glass-section-card rounded-xl p-6';

export function EmailFooterTab({ accountKey }: EmailFooterTabProps) {
  const { accountData, accounts } = useAccount();
  const [config, setConfig] = useState<UnsubscribeFooterConfig>(DEFAULT_FOOTER_CONFIG);
  const [saved, setSaved] = useState<UnsubscribeFooterConfig>(DEFAULT_FOOTER_CONFIG);
  const [inherited, setInherited] = useState(false);
  const [sourceAccountKey, setSourceAccountKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/email-footer`);
      if (!res.ok) throw new Error('Failed to load footer settings');
      const body = await res.json();
      const resolved = resolveFooterConfig(body?.config ?? null);
      setConfig(resolved);
      setSaved(resolved);
      setInherited(Boolean(body?.inherited));
      setSourceAccountKey(body?.sourceAccountKey ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load footer settings');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    if (accountKey) void load();
  }, [accountKey, load]);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(saved),
    [config, saved],
  );

  function set<K extends keyof UnsubscribeFooterConfig>(
    field: K,
    value: UnsubscribeFooterConfig[K],
  ) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/email-footer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to save');
      // Trust the server's echo, not local state: invalid values are
      // silently corrected on write, and the form should show what stored.
      const stored = resolveFooterConfig(body?.config ?? config);
      setConfig(stored);
      setSaved(stored);
      setInherited(false);
      setSourceAccountKey(accountKey);
      toast.success('Footer saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/email-footer`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to revert');
      const resolved = resolveFooterConfig(body?.config ?? null);
      setConfig(resolved);
      setSaved(resolved);
      setInherited(Boolean(body?.inherited));
      setSourceAccountKey(body?.sourceAccountKey ?? null);
      toast.success(
        body?.inherited ? 'Now inheriting the parent account footer' : 'Reset to the default footer',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revert');
    } finally {
      setSaving(false);
    }
  }

  // Preview against this account's real identity, so what you see is what
  // a recipient gets. Placeholders only when the fields aren't filled in —
  // preflight blocks a send in that state anyway.
  const previewHtml = useMemo(() => {
    const footer = buildUnsubscribeFooter(
      {
        dealer: accountData?.dealer || 'Your Dealership',
        address: accountData?.address || '123 Main St',
        city: accountData?.city || 'Layton',
        state: accountData?.state || 'UT',
        postalCode: accountData?.postalCode || '84041',
      },
      { config },
    );
    // The token becomes a real URL at delivery; make it inert here.
    return footer.html.replaceAll(UNSUBSCRIBE_TOKEN, '#');
  }, [accountData, config]);

  const sourceLabel = sourceAccountKey
    ? accounts?.[sourceAccountKey]?.dealer || sourceAccountKey
    : null;

  if (loading) {
    return (
      <div className={`${sectionCardClass} animate-pulse`}>
        <div className="h-4 w-48 bg-[var(--muted)] rounded mb-4" />
        <div className="h-24 bg-[var(--muted)] rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Inheritance state. Without this the values look like this account's
          own, and editing them would silently detach it from the group. */}
      {inherited && (
        <div className="rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-4 py-3">
          <p className="text-sm text-[var(--foreground)]">
            Inherited from <strong>{sourceLabel}</strong>.
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            Changes to {sourceLabel} flow through to this account. Saving here
            creates an override that stops that.
          </p>
        </div>
      )}

      <div className={sectionCardClass}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-1.5">
              Email Footer
              <HelpTip title="What this controls">
                <p>
                  Styling for the compliance block appended to the bottom of
                  every email blast and flow message.
                </p>
                <p className="mt-2">
                  The business name, mailing address, and unsubscribe link are
                  always included — US CAN-SPAM and Canadian CASL require
                  them, so they can&apos;t be turned off here. You control how
                  they look.
                </p>
                <p className="mt-2">
                  If a template already has its own unsubscribe link, this
                  block still adds the mailing address but won&apos;t add a
                  second link.
                </p>
              </HelpTip>
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Applies to this account and any account beneath it that
              hasn&apos;t set its own.
            </p>
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="mb-6">
          <p className={labelClass}>
            Preview
            <HelpTip title="Live preview">
              <p>
                Rendered by the same code the send worker uses, with this
                account&apos;s real business name and address.
              </p>
            </HelpTip>
          </p>
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4 overflow-x-auto">
            <p
              style={{
                font: '14px/1.5 Helvetica,Arial,sans-serif',
                color: '#111',
                margin: 0,
              }}
            >
              …end of your email design…
            </p>
            {/* Renderer output is built from a validated config and escapes
                every account-supplied string — see resolveFooterConfig. */}
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>

        {/* ── Copy ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="footer-optin">
              Opt-in sentence
              <HelpTip title="Opt-in sentence">
                <p>
                  Explains why the recipient is hearing from you. Use{' '}
                  <code>{'{dealer}'}</code> where the business name should
                  appear — it renders in bold.
                </p>
              </HelpTip>
            </label>
            <input
              id="footer-optin"
              type="text"
              value={config.optInLine}
              onChange={(e) => set('optInLine', e.target.value)}
              className={inputClass}
              maxLength={300}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-unsub-label">
              Unsubscribe link text
              <HelpTip title="Link text">
                <p>
                  What the unsubscribe link says. Keep it unambiguous —
                  wording that promises a preference center is misleading,
                  since the link goes straight to an unsubscribe.
                </p>
              </HelpTip>
            </label>
            <input
              id="footer-unsub-label"
              type="text"
              value={config.unsubscribeLabel}
              onChange={(e) => set('unsubscribeLabel', e.target.value)}
              className={inputClass}
              maxLength={60}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-font">Font</label>
            <select
              id="footer-font"
              value={config.fontFamily}
              onChange={(e) => set('fontFamily', e.target.value)}
              className={inputClass}
            >
              {FONT_STACKS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
              {/* A stack saved before this list existed stays selectable. */}
              {!FONT_STACKS.some((f) => f.value === config.fontFamily) && (
                <option value={config.fontFamily}>{config.fontFamily}</option>
              )}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-size">
              Font size
              <HelpTip title="Font size">
                <p>
                  8–24px. Small grey text is the convention for this block, so
                  it doesn&apos;t compete with the design above it.
                </p>
              </HelpTip>
            </label>
            <input
              id="footer-size"
              type="number"
              min={8}
              max={24}
              value={config.fontSizePx}
              onChange={(e) => set('fontSizePx', Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <p className={labelClass}>Alignment</p>
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
              {ALIGNS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => set('align', a)}
                  className={`flex-1 px-3 py-2 text-xs capitalize transition-colors ${
                    config.align === a
                      ? 'bg-[var(--primary)]/15 text-[var(--primary)] font-medium'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <ColorField
            id="footer-text-color"
            label="Text color"
            value={config.textColor}
            onChange={(v) => set('textColor', v)}
          />
          <ColorField
            id="footer-link-color"
            label="Link color"
            value={config.linkColor}
            onChange={(v) => set('linkColor', v)}
          />

          <div>
            <label className={labelClass} htmlFor="footer-bg">
              Background
              <HelpTip title="Background">
                <p>
                  Leave off to inherit whatever the email design uses behind
                  the footer.
                </p>
              </HelpTip>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="footer-bg-toggle"
                type="checkbox"
                checked={config.backgroundColor !== null}
                onChange={(e) =>
                  set('backgroundColor', e.target.checked ? '#f5f5f5' : null)
                }
                className="w-4 h-4 accent-[var(--primary)]"
              />
              <input
                id="footer-bg"
                type="color"
                value={config.backgroundColor ?? '#f5f5f5'}
                disabled={config.backgroundColor === null}
                onChange={(e) => set('backgroundColor', e.target.value)}
                className="h-9 w-14 rounded border border-[var(--border)] bg-transparent disabled:opacity-40"
              />
              <span className="text-xs text-[var(--muted-foreground)]">
                {config.backgroundColor ?? 'Transparent'}
              </span>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-border-toggle">
              Divider line
            </label>
            <div className="flex items-center gap-2">
              <input
                id="footer-border-toggle"
                type="checkbox"
                checked={config.showTopBorder}
                onChange={(e) => set('showTopBorder', e.target.checked)}
                className="w-4 h-4 accent-[var(--primary)]"
              />
              <input
                type="color"
                value={config.borderColor}
                disabled={!config.showTopBorder}
                onChange={(e) => set('borderColor', e.target.value)}
                className="h-9 w-14 rounded border border-[var(--border)] bg-transparent disabled:opacity-40"
              />
              <span className="text-xs text-[var(--muted-foreground)]">
                {config.showTopBorder ? config.borderColor : 'Hidden'}
              </span>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-spacing">
              Space above (px)
            </label>
            <input
              id="footer-spacing"
              type="number"
              min={0}
              max={96}
              value={config.spacingTopPx}
              onChange={(e) => set('spacingTopPx', Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="footer-padding">
              Side padding (px)
            </label>
            <input
              id="footer-padding"
              type="number"
              min={0}
              max={48}
              value={config.paddingXPx}
              onChange={(e) => set('paddingXPx', Number(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-6 pt-5 border-t border-[var(--border)]">
          {/* Only offered once an override exists — there is nothing to
              revert while this account is already inheriting. */}
          {!inherited && sourceAccountKey === accountKey ? (
            <button
              type="button"
              onClick={handleRevert}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            >
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
              Remove this account&apos;s override
            </button>
          ) : (
            <span />
          )}
          <PrimaryButton onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : inherited ? 'Save as override' : 'Save changes'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 rounded border border-[var(--border)] bg-transparent"
        />
        <span className="text-xs font-mono text-[var(--muted-foreground)]">{value}</span>
      </div>
    </div>
  );
}
