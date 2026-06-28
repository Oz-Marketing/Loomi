'use client';

import { useMemo } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  CalendarIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PaintBrushIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import {
  DatePicker,
  toIso as datePickerToIso,
} from '@/components/ui/date-picker';
import type { PacerAd, DirectoryUser } from '@/lib/ad-pacer/types';
import {
  COLORS,
  AD_STATUSES,
  DESIGN_STATUSES,
  APPROVAL_STATUSES,
  ACTION_NEEDED,
  RECURRING_OPTS,
  COOP_OPTS,
  AD_STATUS_COLORS,
  DESIGN_STATUS_COLORS,
  APPROVAL_STATUS_COLORS,
} from '@/lib/ad-pacer/constants';
import { num, fmt, calcDays, effMarkupOf, sourceColor } from '@/lib/ad-pacer/helpers';
import { flightDatePresets, TODAY_PRESET } from '@/lib/ad-pacer/period';
import { Field, DollarInput, inputClass, readonlyClass } from './inputs';
import { ApprovalPill } from './pills';
import { StatusSelect } from './StatusSelect';
import { BudgetTypeToggle, BudgetSourceToggle } from './toggles';
import { CollapsibleSection } from './CollapsibleSection';
import { UserPicker } from './UserPicker';
import { Tooltip } from './Tooltip';
import { Divider, MetricBox } from './metrics';

// ─── PlanAdForm (appended below) ───────────────────────────────────────────
export function PlanAdForm({
  ad,
  users,
  onUpdate,
  markup,
}: {
  ad: PacerAd;
  users: DirectoryUser[];
  onUpdate: (ad: PacerAd) => void;
  // §0.1: resolved per-account factor (override, else agency default), passed
  // down so the Gross Allocation display grosses up at the right rate.
  markup: number | null;
}) {
  const days = calcDays(ad.flightStart, ad.flightEnd);
  const allocation = num(ad.allocation) ?? 0;

  const userById = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);
  const accountRepUser = ad.accountRepUserId ? userById.get(ad.accountRepUserId) : null;

  const designOverdue = (() => {
    if (!ad.creativeDueDate || ad.designStatus === 'Approved') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(ad.creativeDueDate + 'T00:00:00');
    const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0)
      return {
        icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" />,
        label: `Overdue ${Math.abs(diff)}d`,
        bg: 'rgba(239,68,68,0.18)',
        color: '#fca5a5',
      };
    if (diff === 0)
      return {
        icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" />,
        label: 'Due today',
        bg: 'rgba(252,211,77,0.18)',
        color: '#fcd34d',
      };
    if (diff <= 3)
      return {
        icon: <ClockIcon className="w-3.5 h-3.5" />,
        label: `Due in ${diff}d`,
        bg: 'rgba(252,211,77,0.18)',
        color: '#fcd34d',
      };
    if (diff <= 7)
      return {
        icon: <CalendarIcon className="w-3.5 h-3.5" />,
        label: `Due in ${diff}d`,
        bg: 'rgba(190,242,100,0.18)',
        color: '#bef264',
      };
    return null;
  })();

  return (
    <div>
          <Divider
            icon={<ClipboardDocumentListIcon className="w-3 h-3" />}
            label="Ad Details"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Owner / Assigned To">
              <UserPicker
                users={users}
                value={ad.ownerUserId}
                filterFor="owner"
                onChange={(v) => onUpdate({ ...ad, ownerUserId: v })}
              />
            </Field>
          </div>

          <div className="mb-3">
            <Field label="Digital Details">
              <textarea
                value={ad.digitalDetails ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, digitalDetails: e.target.value || null })
                }
                rows={4}
                placeholder="Goal, audience, targeting notes, copy direction…"
                className={`${inputClass} resize-y leading-relaxed min-h-[88px]`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
            <Field label="Action Needed">
              <select
                value={ad.actionNeeded ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, actionNeeded: e.target.value || null })
                }
                className={inputClass}
              >
                <option value="">—</option>
                {ACTION_NEEDED.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recurring?">
              <select
                value={ad.recurring}
                onChange={(e) => onUpdate({ ...ad, recurring: e.target.value })}
                className={inputClass}
              >
                {RECURRING_OPTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Co-op?">
              <select
                value={ad.coop}
                onChange={(e) => onUpdate({ ...ad, coop: e.target.value })}
                className={inputClass}
              >
                {COOP_OPTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ad Status">
              <StatusSelect
                value={ad.adStatus}
                options={AD_STATUSES}
                colorMap={AD_STATUS_COLORS}
                onChange={(newStatus) => {
                  const today = datePickerToIso(new Date());
                  onUpdate({
                    ...ad,
                    adStatus: newStatus,
                    // Stamp the Task Completed date when the ad is scheduled —
                    // that's when the build/setup task is done. Still fires on
                    // Live too (an ad that skips straight to Live), and only
                    // when not already set so a manual date is never overwritten.
                    dateCompleted:
                      (newStatus === 'Scheduled' || newStatus === 'Live') &&
                      !ad.dateCompleted
                        ? today
                        : ad.dateCompleted,
                  });
                }}
                ariaLabel="Ad status"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-xl">
            {/* Due Date — plain user-set date, no auto-fill. */}
            <Field label="Due Date">
              <DatePicker
                value={ad.dueDate}
                onChange={(v) => onUpdate({ ...ad, dueDate: v })}
                placeholder="Pick a date"
                presets={[TODAY_PRESET]}
              />
            </Field>
            <Field label="Task Completed">
              <div className="relative">
                <DatePicker
                  value={ad.dateCompleted}
                  onChange={(v) => onUpdate({ ...ad, dateCompleted: v })}
                  placeholder="Pick a date"
                  presets={[TODAY_PRESET]}
                />
                {ad.dateCompleted &&
                  (ad.adStatus === 'Scheduled' || ad.adStatus === 'Live') && (
                    <span
                      className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: COLORS.success }}
                    >
                      ● Auto-filled when scheduled
                    </span>
                  )}
              </div>
            </Field>
          </div>

          {/* Flight Dates */}
          <Divider icon={<CalendarIcon className="w-3 h-3" />} label="Flight Dates" />
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-2.5 mb-3">
            <Field label="Flight Range (Start – End)">
              <DatePicker
                mode="range"
                value={{ start: ad.flightStart, end: ad.flightEnd }}
                onChange={(r) => {
                  onUpdate({
                    ...ad,
                    flightStart: r.start,
                    flightEnd: r.end,
                  });
                }}
                placeholder="Click & drag to select flight window"
                presets={flightDatePresets(ad.period)}
              />
            </Field>
            <Field label="Actual Live Date" color={COLORS.success}>
              <DatePicker
                value={ad.liveDate}
                onChange={(v) => onUpdate({ ...ad, liveDate: v })}
                placeholder="Not yet live"
                presets={[TODAY_PRESET]}
              />
              {ad.liveDate && ad.flightStart && ad.liveDate > ad.flightStart && (
                <span
                  className="mt-1 inline-block text-[10px] font-bold"
                  style={{ color: COLORS.warn }}
                >
                  +{calcDays(ad.flightStart, ad.liveDate) - 1}d late
                </span>
              )}
            </Field>
            <Field label="Effective Duration">
              <div
                className={`${readonlyClass} font-bold`}
                style={{
                  color:
                    ad.liveDate && ad.flightEnd
                      ? COLORS.success
                      : days > 0
                        ? COLORS.daily
                        : 'var(--muted-foreground)',
                }}
              >
                {ad.liveDate && ad.flightEnd
                  ? `${calcDays(ad.liveDate, ad.flightEnd)} days`
                  : days > 0
                    ? `${days} days`
                    : 'Set dates'}
              </div>
            </Field>
          </div>

          {/* Budget */}
          <Divider icon={<ChartBarIcon className="w-3 h-3" />} label="Budget" />
          <div className="flex flex-wrap gap-2.5 mb-3 items-end">
            <Field label="Budget Type">
              <BudgetTypeToggle
                value={ad.budgetType}
                onChange={(v) => onUpdate({ ...ad, budgetType: v })}
              />
            </Field>
            <Field label="Budget Source">
              <BudgetSourceToggle
                value={ad.budgetSource}
                onChange={(v) => onUpdate({ ...ad, budgetSource: v })}
              />
            </Field>
          </div>
          <div className="mb-3 flex flex-wrap gap-3 items-end">
            <Field
              label="Actual Spend Amount"
              color={sourceColor(ad.budgetSource)}
            >
              {/* Sized for ~$999,999.99 — wide enough for 6 digits + cents
                  without dominating the form like a full-width input. */}
              <div className="w-[180px]">
                <DollarInput
                  value={ad.allocation}
                  onChange={(v) => onUpdate({ ...ad, allocation: v })}
                  placeholder="0.00"
                />
              </div>
            </Field>
            {ad.budgetSource === 'split' && (
              <Field label="Base Portion" color={COLORS.base}>
                <div className="w-[160px]">
                  <DollarInput
                    value={ad.splitBaseAmount}
                    onChange={(v) =>
                      onUpdate({ ...ad, splitBaseAmount: v ?? null })
                    }
                    placeholder="0.00"
                  />
                </div>
              </Field>
            )}
          </div>

          {ad.budgetSource === 'split' && allocation > 0 && (
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              {(() => {
                const baseAlloc = Math.min(
                  Math.max(0, num(ad.splitBaseAmount) ?? 0),
                  allocation,
                );
                const addedAlloc = allocation - baseAlloc;
                return (
                  <>
                    <span style={{ color: COLORS.base }} className="font-semibold">
                      Base: {fmt(baseAlloc)}
                    </span>
                    {' · '}
                    <span style={{ color: COLORS.added }} className="font-semibold">
                      Added: {fmt(addedAlloc)}
                    </span>
                    {baseAlloc > allocation && (
                      <span style={{ color: COLORS.error }} className="ml-2">
                        Base Portion exceeds the total allocation
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {allocation > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
              <MetricBox
                label="Gross Allocation"
                value={
                  effMarkupOf(markup) > 0
                    ? fmt(Math.round((allocation / effMarkupOf(markup)) * 100) / 100)
                    : '—'
                }
                sub="client budget"
              />
              <MetricBox
                label="Actual Spend"
                value={fmt(allocation)}
                color={sourceColor(ad.budgetSource)}
              />
            </div>
          )}

          {/* Creative & Design */}
          <CollapsibleSection
            icon={<PaintBrushIcon className="w-3 h-3" />}
            label="Creative & Design"
          >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3">
            <Field label="Design Status">
              <StatusSelect
                value={ad.designStatus}
                options={DESIGN_STATUSES}
                colorMap={DESIGN_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, designStatus: v })}
                ariaLabel="Design status"
              />
            </Field>
            <Field label="Designer Assigned">
              <UserPicker
                users={users}
                value={ad.designerUserId}
                filterFor="designer"
                onChange={(v) => onUpdate({ ...ad, designerUserId: v })}
              />
            </Field>
            <Field label="Creative Due Date">
              <DatePicker
                value={ad.creativeDueDate}
                onChange={(v) => onUpdate({ ...ad, creativeDueDate: v })}
                placeholder="Pick a date"
                presets={[TODAY_PRESET]}
              />
              {designOverdue && (
                <div
                  className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md border"
                  style={{
                    background: designOverdue.bg,
                    borderColor: `${designOverdue.color}60`,
                    color: designOverdue.color,
                  }}
                >
                  {designOverdue.icon}
                  <span className="text-[10px] font-bold">{designOverdue.label}</span>
                </div>
              )}
            </Field>
          </div>
          <div className="mb-3 max-w-xl">
            <Field label="Creative Link">
              <div className="relative">
                <input
                  value={ad.creativeLink ?? ''}
                  onChange={(e) =>
                    onUpdate({ ...ad, creativeLink: e.target.value || null })
                  }
                  placeholder="https://…"
                  className={`${inputClass} ${ad.creativeLink ? 'pr-10' : ''}`}
                />
                {ad.creativeLink && (
                  <Tooltip
                    label="Open in new tab"
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                  <a
                    href={ad.creativeLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open creative link in new tab"
                    className="p-1.5 rounded text-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                  </Tooltip>
                )}
              </div>
            </Field>
          </div>
          </CollapsibleSection>

          {/* Approvals */}
          <CollapsibleSection
            icon={<CheckBadgeIcon className="w-3 h-3" />}
            label="Approvals"
          >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Account Rep">
              <UserPicker
                users={users}
                value={ad.accountRepUserId}
                filterFor="accountRep"
                onChange={(v) => onUpdate({ ...ad, accountRepUserId: v })}
              />
            </Field>
            <Field label="Client Name">
              <input
                value={ad.clientName ?? ''}
                onChange={(e) =>
                  onUpdate({ ...ad, clientName: e.target.value || null })
                }
                placeholder="Client decision-maker name…"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3 max-w-2xl">
            <Field label="Internal Approval">
              <StatusSelect
                value={ad.internalApproval}
                options={APPROVAL_STATUSES}
                colorMap={APPROVAL_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, internalApproval: v })}
                ariaLabel="Internal approval"
              />
            </Field>
            <Field label="Client Approval">
              <StatusSelect
                value={ad.clientApproval}
                options={APPROVAL_STATUSES}
                colorMap={APPROVAL_STATUS_COLORS}
                onChange={(v) => onUpdate({ ...ad, clientApproval: v })}
                ariaLabel="Client approval"
              />
            </Field>
          </div>
          {/* Approval status summary — clearly labeled by source */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-1 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <UserCircleIcon className="w-3.5 h-3.5" />
                Internal
                {accountRepUser && (
                  <span className="ml-1 text-[var(--foreground)] normal-case tracking-normal">
                    · {accountRepUser.name}
                  </span>
                )}
              </span>
              <ApprovalPill status={ad.internalApproval} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <UserCircleIcon className="w-3.5 h-3.5" />
                Client
                {ad.clientName && (
                  <span className="ml-1 text-[var(--foreground)] normal-case tracking-normal">
                    · {ad.clientName}
                  </span>
                )}
              </span>
              <ApprovalPill status={ad.clientApproval} />
            </div>
          </div>
          </CollapsibleSection>

    </div>
  );
}
