'use client';

/**
 * Help desk modal — report a bug, request a feature, or reach the dev team.
 *
 * Mounted once globally in Providers and opened by `openSupportModal()` from
 * anywhere (the bug icon in all three top bars, the Studio sidebar, the client
 * Ad Generator). A modal rather than a page on purpose: you report a bug from
 * the screen it happened on, so navigating away would cost you the thing you
 * were describing — and it lets the form capture that page automatically.
 *
 * Submissions file onto the Oz Tools Help Desk monday board via
 * `POST /api/support`. The dev team's phone and email sit at the top of the
 * dialog, above the form, because the cases that matter most (an outage, "I
 * can't sign in") are exactly the ones where a form inside the broken app is
 * the wrong channel.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  LifebuoyIcon,
  PhoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { HelpTip } from '@/components/ui/help-tip';
import { useAccount } from '@/contexts/account-context';
import { getCurrentSurface } from '@/lib/cross-site';
import { safeJson } from '@/lib/safe-json';
import { toast } from '@/lib/toast';
import { SUPPORT_MODAL_OPEN_EVENT } from '@/lib/ui-events';
import {
  DEV_CONTACT,
  LIMITS,
  REQUEST_TYPES,
  URGENCY_HINTS,
  URGENCY_LEVELS,
  type RequestType,
  type SupportSurface,
  type Urgency,
} from '@/lib/support/help-desk';

const ACCEPTED_FILES =
  'image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf,video/mp4,video/quicktime';

interface SubmitResponse {
  ok: boolean;
  itemUrl?: string;
  delivery: 'monday' | 'email';
  failedUploads: string[];
}

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]';
const labelClass =
  'flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5';

/** A row of mutually exclusive pills — used for request type and urgency. */
function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              selected
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function ContactStrip() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
      <p className="text-xs text-[var(--muted-foreground)]">
        For anything urgent — or if Loomi itself is down — reach the {DEV_CONTACT.org} dev team
        directly.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <a
          href={`mailto:${DEV_CONTACT.email}`}
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)] hover:underline"
        >
          <EnvelopeIcon className="w-4 h-4 flex-shrink-0" />
          {DEV_CONTACT.email}
        </a>
        <a
          href={`tel:${DEV_CONTACT.phoneHref}`}
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)] hover:underline"
        >
          <PhoneIcon className="w-4 h-4 flex-shrink-0" />
          {DEV_CONTACT.phone}
        </a>
      </div>
    </div>
  );
}

export function SupportModal() {
  const { userName, userEmail, accountData, account } = useAccount();

  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>('Bug/Technical Issue');
  const [urgency, setUrgency] = useState<Urgency>('Medium');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Opened from anywhere via the global event. Capturing the page at OPEN time
  // is the whole advantage of a modal — this is the screen the problem is on.
  useEffect(() => {
    function handleOpen() {
      setResult(null);
      setPageUrl(typeof window !== 'undefined' ? window.location.href : '');
      setOpen(true);
    }
    window.addEventListener(SUPPORT_MODAL_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(SUPPORT_MODAL_OPEN_EVENT, handleOpen);
  }, []);

  // Prefill from the session. Guarded on "still empty" so reopening the dialog
  // never stomps something the user typed over the default.
  useEffect(() => {
    if (userName) setName((prev) => prev || userName);
    if (userEmail) setEmail((prev) => prev || userEmail);
  }, [userName, userEmail]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // Escape is also what dismisses the HelpTip popovers inside the dialog;
      // they stop propagation, so this only fires for the dialog itself.
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Focus the first field so the dialog is immediately typeable. preventScroll
  // matters: a plain focus() scrolls the input into view, which pushes the
  // dev team's phone and email — the whole point of putting them at the top —
  // off the top of the dialog before anyone has seen them.
  useEffect(() => {
    if (open && !result) subjectRef.current?.focus({ preventScroll: true });
  }, [open, result]);

  const accountName = accountData?.dealer ?? null;
  const scopeLabel =
    account.mode === 'admin' ? 'Agency View (all accounts)' : accountName ?? 'No account selected';

  const canSubmit =
    subject.trim().length > 0 && details.trim().length >= 10 && Boolean(name.trim()) && Boolean(email.trim());

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const room = LIMITS.attachmentCount - prev.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${LIMITS.attachmentCount} files.`);
        return prev;
      }
      const accepted: File[] = [];
      for (const file of incoming.slice(0, room)) {
        if (file.size > LIMITS.attachmentBytes) {
          toast.error(
            `"${file.name}" is over ${Math.round(LIMITS.attachmentBytes / (1024 * 1024))}MB.`,
          );
          continue;
        }
        accepted.push(file);
      }
      if (incoming.length > room) toast.info(`Only the first ${room} file(s) were added.`);
      return [...prev, ...accepted];
    });
  }

  /**
   * Screenshots usually arrive on the clipboard (⌘⇧4 → paste), so pasting an
   * image into the description attaches it instead of dropping it.
   */
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
    toast.success(
      pasted.length === 1 ? 'Screenshot attached' : `${pasted.length} screenshots attached`,
    );
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const surface: SupportSurface = getCurrentSurface() ?? 'studio';
      const payload = {
        subject: subject.trim(),
        details: details.trim(),
        requestType,
        urgency,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        accountName: accountName ?? undefined,
        surface,
        pageUrl: pageUrl.trim() || undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        viewport:
          typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : undefined,
      };

      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      for (const file of files) body.append('file', file);

      const res = await fetch('/api/support', { method: 'POST', body });
      const { ok, data, error } = await safeJson<SubmitResponse>(res);
      if (!ok || !data) throw new Error(error || 'Could not submit your request');

      setResult(data);
      // Clear the description so reopening starts fresh; identity fields stay.
      setSubject('');
      setDetails('');
      setFiles([]);
      setUrgency('Medium');

      if (data.failedUploads.length > 0) {
        toast.info(
          `Submitted, but ${data.failedUploads.length} attachment(s) didn't upload. Email them to ${DEV_CONTACT.email}.`,
        );
      } else {
        toast.success('Request submitted');
      }
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : 'Could not submit your request'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[220] bg-black/50 animate-overlay-in flex items-center justify-center p-3 sm:p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Get help"
        className="glass-modal animate-modal-in flex flex-col overflow-hidden w-full max-w-[720px] max-h-[90vh] rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <LifebuoyIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Get Help</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Report a bug, request a feature, or ask the {DEV_CONTACT.org} dev team a question.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex-shrink-0"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="px-6 py-10 text-center overflow-y-auto">
            <CheckCircleIcon className="w-12 h-12 mx-auto text-[var(--primary)]" />
            <p className="mt-4 text-lg font-semibold text-[var(--foreground)]">
              Thanks — we&rsquo;ve got it
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Your request is in the dev team&rsquo;s queue. Someone will be in touch at{' '}
              <span className="text-[var(--foreground)]">{email}</span>.
            </p>
            {result.delivery === 'email' && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                It was emailed to the team directly — our tracker wasn&rsquo;t reachable, so any
                attachments didn&rsquo;t come along. Send those to {DEV_CONTACT.email} if they
                matter.
              </p>
            )}
            {result.failedUploads.length > 0 && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                These attachments didn&rsquo;t upload: {result.failedUploads.join(', ')}. Email them
                to {DEV_CONTACT.email}.
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <PrimaryButton type="button" onClick={close}>
                Done
              </PrimaryButton>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                Submit another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Body (scrolls) ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
              <ContactStrip />

              <div>
                <span className={labelClass}>
                  What kind of request is this?
                  <HelpTip title="Type of request">
                    <p>
                      <strong>Bug/Technical Issue</strong> — something in Loomi is broken or
                      behaving wrongly.
                    </p>
                    <p>
                      <strong>Feature Request</strong> — something you want Loomi to do that it
                      doesn&rsquo;t yet.
                    </p>
                    <p>
                      <strong>Account/Access Issue</strong> — you can&rsquo;t sign in, or
                      you&rsquo;re missing an account or permission.
                    </p>
                    <p>
                      <strong>Training/How-To</strong> — Loomi works, you just want to know how to
                      do something.
                    </p>
                  </HelpTip>
                </span>
                <PillGroup
                  options={REQUEST_TYPES}
                  value={requestType}
                  onChange={setRequestType}
                  ariaLabel="Type of request"
                />
              </div>

              <div>
                <span className={labelClass}>
                  How urgent is it?
                  <HelpTip title="Urgency">
                    <ul>
                      {URGENCY_LEVELS.map((level) => (
                        <li key={level}>
                          <strong>{level}</strong> — {URGENCY_HINTS[level]}
                        </li>
                      ))}
                    </ul>
                  </HelpTip>
                </span>
                <PillGroup
                  options={URGENCY_LEVELS}
                  value={urgency}
                  onChange={setUrgency}
                  ariaLabel="Urgency"
                />
              </div>

              <div>
                <label htmlFor="support-subject" className={labelClass}>
                  Summary
                  <HelpTip title="Summary">
                    <p>
                      One line the dev team can scan in a list — &ldquo;Contacts export downloads an
                      empty file&rdquo; beats &ldquo;export broken&rdquo;.
                    </p>
                  </HelpTip>
                </label>
                <input
                  id="support-subject"
                  ref={subjectRef}
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={LIMITS.subject}
                  placeholder="Short summary of the issue or request"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="support-details" className={labelClass}>
                  Details
                  <HelpTip title="What to include">
                    <p>The more detail, the faster we can fix it. Where possible:</p>
                    <ol>
                      <li>What you were doing, step by step.</li>
                      <li>What you expected to happen.</li>
                      <li>What actually happened.</li>
                    </ol>
                    <p>Screenshots help enormously — you can paste one straight into this box.</p>
                  </HelpTip>
                </label>
                <textarea
                  id="support-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  onPaste={handlePaste}
                  rows={6}
                  maxLength={LIMITS.details}
                  placeholder={
                    'What were you doing?\nWhat did you expect to happen?\nWhat happened instead?'
                  }
                  className={`${inputClass} resize-y`}
                />
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  Paste a screenshot here and it&rsquo;ll be attached automatically.
                </p>
              </div>

              <div>
                <span className={labelClass}>
                  Attachments
                  <HelpTip title="Attachments">
                    <p>
                      Up to {LIMITS.attachmentCount} files,{' '}
                      {Math.round(LIMITS.attachmentBytes / (1024 * 1024))}MB each — screenshots,
                      screen recordings, or a PDF.
                    </p>
                  </HelpTip>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILES}
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={files.length >= LIMITS.attachmentCount}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                >
                  <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                  Add files
                </button>
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]"
                      >
                        <span className="truncate max-w-[22rem] text-[var(--foreground)]">
                          {file.name}
                        </span>
                        <span>{(file.size / 1024).toFixed(0)} KB</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                    <li className="text-[11px] text-[var(--muted-foreground)]">
                      {files.length} of {LIMITS.attachmentCount} ·{' '}
                      {(totalBytes / (1024 * 1024)).toFixed(1)} MB total
                    </li>
                  </ul>
                )}
              </div>

              <div>
                <label htmlFor="support-page-url" className={labelClass}>
                  Where did it happen?
                  <HelpTip title="Page address">
                    <p>
                      Filled in with the page you were on when you opened this. Paste a different
                      address if the problem was somewhere else.
                    </p>
                  </HelpTip>
                </label>
                <input
                  id="support-page-url"
                  type="text"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  maxLength={LIMITS.pageUrl}
                  placeholder="https://studio.loomilm.com/…"
                  className={inputClass}
                />
              </div>

              <div className="pt-1 border-t border-[var(--border)]">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mt-4 mb-3">
                  So we can reach you
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="support-name" className={labelClass}>
                      Your name
                    </label>
                    <input
                      id="support-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={LIMITS.name}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="support-email" className={labelClass}>
                      Email
                    </label>
                    <input
                      id="support-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={LIMITS.email}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="support-phone" className={labelClass}>
                      Phone
                      <HelpTip title="Phone">
                        <p>
                          Optional — but for a Critical issue it&rsquo;s the fastest way for us to
                          reach you.
                        </p>
                      </HelpTip>
                    </label>
                    <input
                      id="support-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={LIMITS.phone}
                      placeholder="Optional"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <span className={labelClass}>
                      Account
                      <HelpTip title="Account">
                        <p>
                          Taken from the account you were working in — switch accounts before
                          opening this if the issue belongs to a different one.
                        </p>
                      </HelpTip>
                    </span>
                    <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 text-[var(--muted-foreground)] truncate">
                      {scopeLabel}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
              <span className="text-xs text-[var(--muted-foreground)]">
                {canSubmit ? ' ' : 'Add a summary and a sentence or two of detail to submit.'}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={close}
                  className="px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  Cancel
                </button>
                <PrimaryButton type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                  {submitting ? 'Submitting…' : 'Submit request'}
                </PrimaryButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
