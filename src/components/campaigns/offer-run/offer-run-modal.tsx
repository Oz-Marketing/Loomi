'use client';

/**
 * Generate from OEM offers — the on-demand run, from Campaigns.
 *
 * Four steps, because the three things a person needs to know before a run
 * are different things: WHO it runs for (never skipped — the default landing
 * for staff is the largest group, whose key has no offers), WHAT it will build
 * (the picker), and WHAT WILL HAPPEN (designs, email, where it lands, who sees
 * it). Then it runs, and the last step follows the run: the server answers 202
 * and the run finishes behind it, because a full fan-out takes minutes and the
 * proxy closes a socket at 60 seconds.
 *
 * Every string obeys the house vocabulary: "account", "group", "design".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { BoltIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { HelpTip } from '@/components/ui/help-tip';
import { isVehicleIndustry } from '@/lib/ad-generator/industry';
import { OFFER_TYPES, OfferScopePicker, resolveScope } from '@/components/ad-generator/offer-scope-picker';
import {
  OfferRunStartError,
  useOfferRun,
  type OfferRunStatus,
} from '@/components/ad-generator/use-offer-run';

type Step = 'account' | 'offers' | 'review' | 'done';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

function windowLabel(w: { start: string } | null): string {
  if (!w) return 'this month';
  return new Date(w.start).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function OfferRunModal({
  open,
  onClose,
  initialAccountKey,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** The account the run is for. When the scope is a group, the first step asks. */
  initialAccountKey: string | null;
  /** Called when a run finishes with a campaign, so the list can refetch. */
  onDone?: (campaignId: string | null) => void;
}) {
  const { accounts, scopedAccountKeys } = useAccount();
  const href = useSubaccountHref();
  const [accountKey, setAccountKey] = useState<string | null>(initialAccountKey);
  const [step, setStep] = useState<Step>('account');
  const [types, setTypes] = useState<string[]>([...OFFER_TYPES]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [notify, setNotify] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<OfferRunStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { preflight, checkOffers, start, pollRun } = useOfferRun(accountKey, open);

  // Reset when (re)opened.
  useEffect(() => {
    if (!open) return;
    setAccountKey(initialAccountKey);
    setStep('account');
    setTypes([...OFFER_TYPES]);
    setPicked(null);
    setNotify(true);
    setStartError(null);
    setRunId(null);
    setRun(null);
  }, [open, initialAccountKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !starting && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, starting, onClose]);

  // Follow the run.
  useEffect(() => {
    if (!runId || run?.finishedAt) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    const tick = async () => {
      const next = await pollRun(runId);
      if (next) setRun(next);
      if (next?.finishedAt) onDone?.(next.campaignId);
    };
    void tick();
    timer.current = setInterval(tick, 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [runId, run?.finishedAt, pollRun, onDone]);

  const account = accountKey ? accounts[accountKey] : null;
  const accountName = account?.dealer || accountKey || 'this account';
  const vehicleAccounts = useMemo(
    () => scopedAccountKeys.filter((k) => isVehicleIndustry(accounts[k]?.category)),
    [scopedAccountKeys, accounts],
  );
  const scope = useMemo(() => resolveScope(preflight.candidates, types, picked), [preflight.candidates, types, picked]);
  const capped = Math.min(scope.total, preflight.maxVehiclesPerRun);
  const cycle = windowLabel(preflight.runWindow);

  const blocked = preflight.readiness !== 'ready' && preflight.readiness !== 'loading';

  async function begin() {
    setStarting(true);
    setStartError(null);
    try {
      const id = await start({ vehicles: scope.vehicles, offerTypes: scope.offerTypes }, notify);
      setRunId(id);
      setStep('done');
    } catch (err) {
      if (err instanceof OfferRunStartError && err.code === 'run_in_progress') {
        setStartError(`A run is already in progress for ${accountName}. Try again in a minute.`);
      } else if (err instanceof OfferRunStartError && err.code === 'not_ready') {
        setStartError(
          err.readiness === 'no_offers'
            ? `No manufacturer offers are on file for ${accountName} yet.`
            : `Ad automation isn’t set up for ${accountName} yet.`,
        );
      } else {
        setStartError(err instanceof Error ? err.message : 'Could not start the run.');
      }
    } finally {
      setStarting(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  const settingsLink = (
    <Link href="/settings/ad-automation?tab=settings" className="font-medium text-[var(--primary)] hover:underline">
      Open Ad Automation settings
    </Link>
  );

  const body = (
    <div className="animate-overlay-in fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => !starting && onClose()}>
      <div
        className="animate-modal-in relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Generate from OEM offers"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <BoltIcon className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">Generate from OEM offers</h2>
              <HelpTip title="How the offer is picked" iconClassName="h-3.5 w-3.5">
                <p>A model usually has several live manufacturer offers at once. One ad can only show one, so they&apos;re ranked: offers ending before the planning window are dropped, then any type you switch off, then type order decides — lease, then APR, then cash — and within a type the strongest number wins.</p>
              </HelpTip>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {step === 'done' ? `Building for ${accountName}` : `Step ${step === 'account' ? 1 : step === 'offers' ? 2 : 3} of 3`}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={starting} aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* ── 1. Account ── */}
          {step === 'account' && (
            <div className="animate-fade-in-up space-y-4">
              {vehicleAccounts.length > 1 && !initialAccountKey ? (
                <div>
                  <p className="text-sm text-[var(--foreground)]">Pick the account to run for — offers are watched per account.</p>
                  <div className="mt-3 space-y-1">
                    {vehicleAccounts.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setAccountKey(k)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          accountKey === k ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]' : 'border-[var(--border)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {accounts[k]?.dealer || k}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--foreground)]">
                  For <span className="font-semibold">{accountName}</span>
                </p>
              )}

              {accountKey && preflight.readiness === 'loading' && (
                <p className="text-xs text-[var(--muted-foreground)]">Checking this account’s offers and setup…</p>
              )}
              {accountKey && preflight.readiness === 'no_access' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                  You don’t have access to the Ad Generator. Ask an admin to add a Studio role to your user in Settings → Users.
                </p>
              )}
              {accountKey && preflight.readiness === 'no_config' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                  Ad automation isn’t set up for {accountName} yet. {settingsLink}
                </p>
              )}
              {accountKey && preflight.readiness === 'no_offers' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                  No manufacturer offers are on file for {accountName} yet —{' '}
                  {preflight.lastPollAt ? `last checked ${ago(preflight.lastPollAt)}.` : 'offers have never been checked.'}{' '}
                  <button
                    type="button"
                    disabled={checking}
                    onClick={async () => {
                      setChecking(true);
                      try {
                        await checkOffers();
                      } finally {
                        setChecking(false);
                      }
                    }}
                    className="font-medium underline disabled:opacity-50"
                  >
                    {checking ? 'Checking…' : 'Check for new offers'}
                  </button>
                </div>
              )}
              {accountKey && preflight.readiness === 'ready' && (
                <div className="space-y-2">
                  {preflight.warnings.includes('no_lead_design') && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                      No recommended design is set. Every offer will show all of its designs, with none marked Recommended.{' '}
                      {settingsLink}
                    </p>
                  )}
                  {preflight.warnings.includes('automation_off') && (
                    <p className="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
                      Automation off
                      <HelpTip title="Automation off" iconClassName="h-3 w-3">
                        <p>Nothing runs on a schedule for this account, so this run happens once. Turn automation on in Ad Automation settings.</p>
                      </HelpTip>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 2. Offers ── */}
          {step === 'offers' && (
            <div className="animate-fade-in-up">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1">
                  Building for <span className="font-medium text-[var(--foreground)]">{cycle}</span> · offers as of {ago(preflight.lastPollAt)}
                  <HelpTip title="The planning window" iconClassName="h-3 w-3">
                    <p>Offers that end before the window starts are left out. The window comes from “Plan for” in Ad Automation settings.</p>
                  </HelpTip>
                </span>
                <button
                  type="button"
                  disabled={checking}
                  onClick={async () => {
                    setChecking(true);
                    try {
                      await checkOffers();
                    } finally {
                      setChecking(false);
                    }
                  }}
                  className="font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
                >
                  {checking ? 'Checking…' : 'Check for new offers'}
                </button>
              </div>
              <OfferScopePicker
                candidates={preflight.candidates}
                maxVehiclesPerRun={preflight.maxVehiclesPerRun}
                types={types}
                onTypesChange={setTypes}
                picked={picked}
                onPickedChange={setPicked}
              />
            </div>
          )}

          {/* ── 3. Review ── */}
          {step === 'review' && (
            <dl className="animate-fade-in-up space-y-3 text-sm">
              <Row label="For">{accountName}</Row>
              <Row label="Building">
                {capped} vehicle{capped === 1 ? '' : 's'} · {types.map((t) => t.toUpperCase() === 'APR' ? 'APR' : t[0].toUpperCase() + t.slice(1)).join(', ')} offers
              </Row>
              <Row label="Designs">
                {preflight.permitted.source === 'all_published'
                  ? `Every published design in scope (${preflight.permitted.count})`
                  : `Each offer is built in the ${preflight.permitted.count} design${preflight.permitted.count === 1 ? '' : 's'} this account allows${
                      preflight.permitted.playbookName ? ` — from the playbook “${preflight.permitted.playbookName}”` : ''
                    }`}
                <HelpTip title="Which designs are built" iconClassName="ml-1 inline h-3 w-3">
                  <p>A playbook narrows which designs are built. The account picks the design to use on the campaign.</p>
                </HelpTip>
              </Row>
              <Row label="Recommended">{preflight.leadDesignName ?? 'none set'}</Row>
              <Row label="Ad status">
                {preflight.mode === 'ready'
                  ? 'Ads with a current co-op approval or a verified co-op pack land as Ready; the rest are held as drafts.'
                  : 'Every ad lands as a draft.'}
              </Row>
              <Row label="Offer email">
                {preflight.emailEnabled
                  ? `Drafted for ${cycle}${preflight.emailAudienceName ? `, sent to ${preflight.emailAudienceName}` : ' — pick who receives it before sending'}`
                  : 'Off for this account — the campaign holds the ads only.'}
              </Row>
              <Row label="Lands in">“{cycle} offers — {accountName}”</Row>
              <p className="text-xs text-[var(--muted-foreground)]">
                The account’s users can see this campaign as soon as it’s built. While it builds, they see “Building…” and can’t pick designs.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                <span className="flex items-center gap-1">
                  Tell the account’s users their offers are ready
                  <HelpTip title="Notifying the account" iconClassName="h-3 w-3">
                    <p>One notice per campaign per day, and only when the run built something new. Uncheck it for a test run.</p>
                  </HelpTip>
                </span>
              </label>
              {startError && <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">{startError}</p>}
            </dl>
          )}

          {/* ── 4. Done ── */}
          {step === 'done' && (
            <div className="animate-fade-in-up space-y-3 text-sm">
              {!run?.finishedAt ? (
                <div className="flex items-start gap-2 text-[var(--foreground)]">
                  <BoltIcon className="mt-0.5 h-4 w-4 animate-pulse text-[var(--primary)]" />
                  <p>
                    Building designs for {accountName} — this can take a few minutes. You can close this and check Run history.
                  </p>
                </div>
              ) : run.error ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
                  The run stopped: {run.error}. Check Run history in Ad Automation settings.
                </p>
              ) : (
                <>
                  <p className="font-medium text-[var(--foreground)]">
                    {run.generated === 0
                      ? `No offers are live for the ${cycle} window yet, so nothing was built.`
                      : `Built ${run.generated} design${run.generated === 1 ? '' : 's'}${run.refreshed ? ` (${run.refreshed} refreshed)` : ''}${
                          run.skipped ? ` · ${run.skipped} vehicle${run.skipped === 1 ? '' : 's'} skipped` : ''
                        }`}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {!run.email || run.email.reason === 'email_disabled'
                      ? 'Email is off for this account.'
                      : run.email.reason === 'already_sent'
                        ? `The ${cycle} email was already sent, so it was left alone; the new ads are on the campaign.`
                        : run.email.reason === 'no_disclaimer'
                          ? 'No offer had a usable disclaimer, so no email was drafted.'
                          : run.email.reason === 'failed'
                            ? 'Offer email failed — the ads are on the campaign.'
                            : run.email.blastId
                              ? run.email.updated
                                ? 'Offer email refreshed.'
                                : 'Offer email drafted.'
                              : 'No offer email this run.'}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-4">
          {step === 'done' ? (
            <>
              <Link href="/settings/ad-automation?tab=settings" className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
                Run history
              </Link>
              {run?.campaignId ? (
                <Link
                  href={href(`/campaign-builder/${run.campaignId}`)}
                  onClick={onClose}
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                >
                  Open campaign
                </Link>
              ) : (
                <button type="button" onClick={onClose} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)]">
                  Done
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={starting} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
                Cancel
              </button>
              {step !== 'account' && (
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => setStep(step === 'review' ? 'offers' : 'account')}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
                >
                  Back
                </button>
              )}
              {step === 'account' && (
                <button
                  type="button"
                  disabled={!accountKey || blocked || preflight.readiness === 'loading'}
                  onClick={() => setStep('offers')}
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue
                </button>
              )}
              {step === 'offers' && (
                <button
                  type="button"
                  disabled={scope.total === 0 || types.length === 0}
                  onClick={() => setStep('review')}
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue
                </button>
              )}
              {step === 'review' && (
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void begin()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <BoltIcon className={`h-3.5 w-3.5 ${starting ? 'animate-pulse' : ''}`} />
                  {starting ? 'Starting…' : `Generate for ${capped} vehicle${capped === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3">
      <dt className="text-xs font-medium text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-[var(--foreground)]">{children}</dd>
    </div>
  );
}
