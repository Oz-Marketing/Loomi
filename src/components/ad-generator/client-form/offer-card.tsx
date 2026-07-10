'use client';

import { useMemo } from 'react';
import { isFieldVisible, type AdData, type FieldSpec } from '@/lib/ad-generator/types';
import { OemIncentivesPanel } from './oem-incentives-panel';
import { VehicleColorPicker } from './vehicle-colors';
import { Field } from './fields';

export type VehicleSlot = { imageKey: string; nameKey: string; codeKey: string; label: string };

// Keys the MarketCheck incentive apply() fills. Fields NOT in this set (e.g.
// securityDeposit) are the ones a rep still edits after applying an offer.
const INCENTIVE_KEYS = new Set(['offerType', 'monthlyPayment', 'leaseTerm', 'dueAtSigning', 'aprRate', 'aprTerm', 'discountAmount', 'msrp', 'expiration', 'vehicleName']);
const baseKey = (k: string) => k.replace(/^o2_/, '');

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
  // An OEM incentive was actually applied — the ONLY reliable signal, since a
  // fresh creative carries template defaults (monthly $299, MSRP $34,000,
  // "2024 Toyota Camry SE" …) that are indistinguishable from a real offer by
  // value. `_oemApplied` is set by the incentive apply(); `_vehMake` (the
  // stashed searched vehicle) is a fallback for offers applied before the flag.
  const oemApplied = useMemo(() => {
    const flag = (k: string) => !!(data[k] ?? '').toString().trim();
    return flag('_oemApplied') || flag('o2__oemApplied') || flag('_vehMake') || flag('o2__vehMake');
  }, [data]);
  // A resolvable "YYYY Make Model" vehicle name — lets Manual entry keep the
  // color picker even without an OEM selection.
  const hasVehicle = useMemo(
    () => vehicleSlots.some((slot) => /^\d{4}\s+\S+\s+.+$/.test((data[slot.nameKey] ?? data.vehicleName ?? '').toString().trim())),
    [vehicleSlots, data],
  );
  // Fields the incentive does NOT provide (e.g. Security deposit) — editable
  // inputs under the locked recap so an OEM offer can still be completed.
  // Membership is value-INDEPENDENT (keyed off INCENTIVE_KEYS, not the current
  // value) so typing doesn't move the field into the recap and remount it.
  const editableRest = useMemo(
    () =>
      manualFields.filter(
        (f) => isFieldVisible(f, data) && !/^(o2_)?(offerType|offerLabel)$/i.test(f.key) && !INCENTIVE_KEYS.has(baseKey(f.key)),
      ),
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
          {/* No manufacturer recap card — the selected incentive card above shows
              the offer. We only surface the fields the incentive doesn't provide
              (e.g. Security deposit) so an OEM offer can still meet compliance. */}
          {oemApplied && editableRest.length > 0 && (
            <div className="mt-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Additional details</div>
              {editableRest.map((f) => (
                <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={allowVehiclePicker} />
              ))}
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

      {/* Vehicle color — only after an OEM offer is applied (which loads the
          vehicle), or on Manual entry once a vehicle name is set. Never shown on
          a fresh OEM tab, where template defaults would otherwise surface it. */}
      {vehicleSlots.length > 0 && (oemApplied || (offerSource === 'manual' && hasVehicle)) && (
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
