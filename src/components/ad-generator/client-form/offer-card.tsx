'use client';

import { useMemo, useState } from 'react';
import { isFieldVisible, type AdData, type FieldSpec } from '@/lib/ad-generator/types';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { OemIncentivesPanel } from './oem-incentives-panel';
import { VehicleColorPicker } from './vehicle-colors';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from './evox-makes';
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
  // A vehicle was EXPLICITLY chosen — via an OEM incentive apply or the Manual
  // YMM picker, both of which stash `_vehMake`. This (not the template-default
  // vehicleName) is what reveals the color swatches, so a fresh creative never
  // shows them without input.
  const vehicleChosen = useMemo(() => !!(data['_vehMake'] || data['o2__vehMake']), [data]);
  // …and its name resolves to a full "YYYY Make Model" so EVOX can look it up.
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
            // Restore the previous search/selection (persisted by apply()).
            initial={{
              year: data._vehYear,
              make: data._vehMake,
              model: data._vehModel,
              zip: data._oemZip,
              selectedKey: data._oemSelectedKey,
            }}
            onApply={(patch) =>
              setData((d) => {
                const next = { ...d, ...patch };
                // A manually-set expiration wins over the OEM offer's end date.
                if (patch.expiration && d.expiration?.trim()) next.expiration = d.expiration;
                return next;
              })
            }
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
          {/* Automotive templates get a Year/Make/Model picker here so the vehicle
              (and thus the color swatches) can be chosen without an OEM incentive.
              Sets vehicleName + the same `_veh*` stash the incentive apply() uses. */}
          {vehicleSlots.length > 0 && (
            <ManualVehiclePicker
              initial={{ year: data._vehYear, make: data._vehMake, model: data._vehModel }}
              defaultMake={oemMake}
              onChange={({ year, make, model }) =>
                setData((d) => ({
                  ...d,
                  vehicleName: [year, make, model].filter(Boolean).join(' '),
                  _vehYear: year,
                  _vehMake: make,
                  _vehModel: model,
                }))
              }
            />
          )}
          {manualFields.length ? (
            manualFields.map((f) => <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={allowVehiclePicker} />)
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">This template has no editable offer fields.</p>
          )}
        </div>
      )}

      {/* Vehicle color — only once a vehicle has been EXPLICITLY chosen (OEM
          apply or the Manual YMM picker) AND its name resolves. Template defaults
          never trigger it, on either tab. */}
      {vehicleSlots.length > 0 && vehicleChosen && hasVehicle && (
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

/**
 * Compact Year / Make / Model picker for the Manual entry tab — sets the vehicle
 * so the color picker can load EVOX swatches without an OEM incentive. Local
 * state keeps the inputs snappy; every change is pushed up so `vehicleName` +
 * the `_veh*` stash stay in the ad data.
 */
function ManualVehiclePicker({
  initial,
  defaultMake,
  onChange,
}: {
  initial?: { year?: string; make?: string; model?: string };
  defaultMake?: string;
  onChange: (v: { year: string; make: string; model: string }) => void;
}) {
  const [year, setYear] = useState(initial?.year || String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(initial?.make || defaultMake || '');
  const [model, setModel] = useState(initial?.model || '');
  const yearOptions: FontSelectOption[] = EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: FontSelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
        Vehicle <span className="font-normal text-[var(--muted-foreground)]">— sets the vehicle + loads its colors below</span>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <FontSelect value={year} onChange={(v) => { setYear(v); onChange({ year: v, make, model }); }} options={yearOptions} previewFont={false} />
        <FontSelect value={make} onChange={(v) => { setMake(v); onChange({ year, make: v, model }); }} options={makeOptions} previewFont={false} />
        <input
          value={model}
          onChange={(e) => { setModel(e.target.value); onChange({ year, make, model: e.target.value }); }}
          placeholder="Model"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />
      </div>
    </div>
  );
}
