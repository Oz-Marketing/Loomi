'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { DatePicker } from '@/components/ui/date-picker';
import type { DirectoryUser, PacerAd } from '@/lib/ad-pacer/types';
import {
  AD_STATUSES,
  DESIGN_STATUSES,
  APPROVAL_STATUSES,
} from '@/lib/ad-pacer/constants';
import { inputClass, labelClass } from '@/app/app/tools/_shared';

// Meta-only bulk-edit modal for multi-selected plan rows. Split out of
// MetaAdsPlannerTool to shrink the file.
export type BulkField =
  | 'flight'
  | 'budgetType'
  | 'budgetSource'
  | 'owner'
  | 'adStatus'
  | 'designStatus'
  | 'internalApproval'
  | 'clientApproval';

const BULK_FIELD_LABELS: Record<BulkField, string> = {
  flight: 'Flight Dates',
  budgetType: 'Budget Type',
  budgetSource: 'Budget Source',
  owner: 'Owner',
  adStatus: 'Ad Status',
  designStatus: 'Design Status',
  internalApproval: 'Internal Status',
  clientApproval: 'Client Status',
};

export function BulkEditModal({
  field,
  count,
  users,
  onClose,
  onApply,
}: {
  field: BulkField;
  count: number;
  users: DirectoryUser[];
  onClose: () => void;
  onApply: (patch: Partial<PacerAd>) => void;
}) {
  const [flightStart, setFlightStart] = useState<string | null>(null);
  const [flightEnd, setFlightEnd] = useState<string | null>(null);
  const [budgetType, setBudgetType] = useState<'Daily' | 'Lifetime'>('Daily');
  const [budgetSource, setBudgetSource] = useState<'base' | 'added'>('base');
  const [ownerId, setOwnerId] = useState<string>('');
  const [adStatus, setAdStatus] = useState<string>(AD_STATUSES[0]);
  const [designStatus, setDesignStatus] = useState<string>(DESIGN_STATUSES[0]);
  const [internalApproval, setInternalApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );
  const [clientApproval, setClientApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );

  const noun = `${count} ad${count !== 1 ? 's' : ''}`;

  const handleSubmit = () => {
    switch (field) {
      case 'flight':
        if (!flightStart || !flightEnd) return;
        onApply({ flightStart, flightEnd });
        return;
      case 'budgetType':
        onApply({ budgetType });
        return;
      case 'budgetSource':
        onApply({ budgetSource });
        return;
      case 'owner':
        // Empty string clears the owner — treat that as a valid choice.
        onApply({ ownerUserId: ownerId === '' ? null : ownerId });
        return;
      case 'adStatus':
        onApply({ adStatus });
        return;
      case 'designStatus':
        onApply({ designStatus });
        return;
      case 'internalApproval':
        onApply({ internalApproval });
        return;
      case 'clientApproval':
        onApply({ clientApproval });
        return;
    }
  };

  const submitDisabled = field === 'flight' && (!flightStart || !flightEnd);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:pt-24 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-md rounded-xl p-5"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Set {BULK_FIELD_LABELS[field]}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Applies to {noun}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          {field === 'flight' && (
            <>
              <label className={labelClass}>Flight Range (Start – End)</label>
              <DatePicker
                mode="range"
                value={{ start: flightStart, end: flightEnd }}
                onChange={(r) => {
                  setFlightStart(r.start);
                  setFlightEnd(r.end);
                }}
                placeholder="Click & drag to select flight window"
              />
            </>
          )}
          {field === 'budgetType' && (
            <>
              <label className={labelClass}>Budget Type</label>
              <select
                value={budgetType}
                onChange={(e) => setBudgetType(e.target.value as 'Daily' | 'Lifetime')}
                className={inputClass}
              >
                <option value="Daily">Daily</option>
                <option value="Lifetime">Lifetime</option>
              </select>
            </>
          )}
          {field === 'budgetSource' && (
            <>
              <label className={labelClass}>Budget Source</label>
              <select
                value={budgetSource}
                onChange={(e) => setBudgetSource(e.target.value as 'base' | 'added')}
                className={inputClass}
              >
                <option value="base">Base</option>
                <option value="added">Added</option>
              </select>
            </>
          )}
          {field === 'owner' && (
            <>
              <label className={labelClass}>Owner</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'adStatus' && (
            <>
              <label className={labelClass}>Ad Status</label>
              <select
                value={adStatus}
                onChange={(e) => setAdStatus(e.target.value)}
                className={inputClass}
              >
                {AD_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'designStatus' && (
            <>
              <label className={labelClass}>Design Status</label>
              <select
                value={designStatus}
                onChange={(e) => setDesignStatus(e.target.value)}
                className={inputClass}
              >
                {DESIGN_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'internalApproval' && (
            <>
              <label className={labelClass}>Internal Status</label>
              <select
                value={internalApproval}
                onChange={(e) => setInternalApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'clientApproval' && (
            <>
              <label className={labelClass}>Client Status</label>
              <select
                value={clientApproval}
                onChange={(e) => setClientApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply to {noun}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
