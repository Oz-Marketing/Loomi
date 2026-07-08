'use client';

import { useMemo } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import type { AdData, FieldSpec } from '@/lib/ad-generator/types';
import { OemIncentivesPanel } from './oem-incentives-panel';
import { VehicleColorPicker } from './vehicle-colors';
import { Field } from './fields';

export type VehicleSlot = { imageKey: string; nameKey: string; codeKey: string; label: string };

/**
 * The unified Offer card — the single home for the vehicle + offer, for both
 * managers and clients. It replaces the old split of a separate "Offer" source
 * card, a standalone "Offer" fields card, and a standalone "Vehicle" card:
 *
 *  • OEM Incentive tab — search MarketCheck and apply an incentive. Since those
 *    values come straight from the manufacturer and can't be hand-edited, an
 *    applied offer shows as a LOCKED read-only recap (not editable fields).
 *  • Manual entry tab — the editable offer fields, inline.
 *  • Vehicle color — the paint picker, folded in under the offer (the offer
 *    already determines the vehicle), with inline cropped jellybean swatches.
 */
export function OfferCard({
  data,
  set,
  setData,
  isDual,
  dualVehicleMode,
  setDualVehicleMode,
  offerSource,
  setOfferSource,
  manualFields,
  vehicleSlots,
  oemMake,
  defaultZip,
  accountKey,
  allowVehiclePicker,
}: {
  data: AdData;
  set: (key: string, value: string) => void;
  setData: (updater: (d: AdData) => AdData) => void;
  isDual: boolean;
  dualVehicleMode: 'same' | 'two';
  setDualVehicleMode: (m: 'same' | 'two') => void;
  offerSource: 'oem' | 'manual';
  setOfferSource: (s: 'oem' | 'manual') => void;
  /** Editable offer fields (offer numbers + vehicle name), for the Manual tab
   *  and the OEM recap. Excludes the vehicle image (that's the color picker). */
  manualFields: FieldSpec[];
  vehicleSlots: VehicleSlot[];
  oemMake?: string;
  defaultZip?: string;
  accountKey?: string;
  allowVehiclePicker: boolean;
}) {
  // The OEM tab swaps its results for a locked recap once an offer has actually
  // been applied — detected by a SUBSTANTIVE value (payment / term / amount /
  // vehicle), not just `offerType`/`offerLabel`, which carry template defaults.
  const recapRows = useMemo(
    () => manualFields.map((f) => ({ label: f.label, value: (data[f.key] ?? '').toString().trim() })).filter((r) => r.value),
    [manualFields, data],
  );
  const hasOffer = useMemo(
    () => manualFields.some((f) => !/^(o2_)?(offerType|offerLabel)$/i.test(f.key) && (data[f.key] ?? '').toString().trim()),
    [manualFields, data],
  );

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Offer</h2>

      {/* Source tabs — where the vehicle + offer come from. */}
      <div className="mb-4 flex items-center gap-5 border-b border-[var(--border)]">
        {(['oem', 'manual'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setOfferSource(s)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors ${
              offerSource === s ? 'border-[var(--primary)] text-[var(--foreground)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {s === 'oem' ? 'OEM Incentive' : 'Manual entry'}
          </button>
        ))}
      </div>

      {/* Dual-offer structure — a distinct config row (not another pill pair). */}
      {isDual && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-[var(--muted)]/40 px-3 py-2">
          <span className="text-xs font-medium text-[var(--foreground)]">The two offers are on</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
            {([['same', 'One model'], ['two', 'Two models']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setDualVehicleMode(val)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  dualVehicleMode === val ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {offerSource === 'oem' ? (
        <>
          <OemIncentivesPanel
            defaultMake={oemMake}
            defaultZip={defaultZip}
            dual={isDual}
            dualVehicleMode={dualVehicleMode}
            accountKey={accountKey}
            onApply={(patch) => setData((d) => ({ ...d, ...patch }))}
          />
          {hasOffer && (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <LockClosedIcon className="h-3.5 w-3.5" />
                From the manufacturer
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {recapRows.map((r) => (
                  <div key={r.label} className="flex flex-col">
                    <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{r.label}</dt>
                    <dd className="text-sm font-medium text-[var(--foreground)]">{r.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">These come straight from the incentive and can’t be edited. Pick a different incentive above to change them.</p>
            </div>
          )}
        </>
      ) : (
        // Manual entry — the editable offer fields, inline (no separate card).
        <div className="space-y-4">
          {manualFields.length ? (
            manualFields.map((f) => <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={allowVehiclePicker} />)
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">This template has no editable offer fields.</p>
          )}
        </div>
      )}

      {/* Vehicle color — folded in under the offer. The offer already decides the
          vehicle; here you pick the paint. Inline cropped swatches, no modal. */}
      {vehicleSlots.length > 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Vehicle color</h3>
          <div className="space-y-4">
            {vehicleSlots.map((slot) => (
              <div key={slot.imageKey}>
                {vehicleSlots.length > 1 && <div className="mb-1.5 text-[11px] font-medium text-[var(--foreground)]">{slot.label}</div>}
                <VehicleColorPicker
                  vehicleName={data[slot.nameKey] ?? data.vehicleName ?? ''}
                  selectedCode={data[slot.codeKey] ?? ''}
                  onPick={(url, code) => setData((d) => ({ ...d, [slot.imageKey]: url, [slot.codeKey]: code }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
