'use client';

import { useMemo, useState } from 'react';
import { isFieldVisible, type AdData, type FieldSpec } from '@/lib/ad-generator/types';
import { Select, type SelectOption } from '@/components/select';
import { VehicleColorPicker } from './vehicle-colors';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from './evox-makes';
import { Field } from './fields';

export type VehicleSlot = { imageKey: string; nameKey: string; codeKey: string; label: string };

/**
 * The Offer card — the vehicle and the offer numbers for a CUSTOM ad.
 *
 * It used to carry an "OEM Incentive" tab that searched MarketCheck and applied a
 * manufacturer offer. That tab is gone: regional OEM offers are produced by the
 * automation pipeline, and asking a dealer to re-key an offer the feed already
 * has was the manual grind this tool exists to remove. The ad generator is now
 * for the ads a person actually invents.
 *
 * The apply LOGIC (`incentiveToFieldPatch`) is untouched and still used by
 * `automation/generate-ads.ts` — only the interactive entry point is removed.
 */
export function OfferCard({
  data,
  set,
  setData,
  isDual,
  dualVehicleMode,
  setDualVehicleMode,
  manualFields,
  vehicleSlots,
  oemMake,
  allowVehiclePicker,
}: {
  data: AdData;
  set: (key: string, value: string) => void;
  setData: (updater: (d: AdData) => AdData) => void;
  isDual: boolean;
  dualVehicleMode: 'same' | 'two';
  setDualVehicleMode: (m: 'same' | 'two') => void;
  /** The editable offer fields (offer numbers + vehicle name). */
  manualFields: FieldSpec[];
  vehicleSlots: VehicleSlot[];
  oemMake?: string;
  allowVehiclePicker: boolean;
}) {
  // A vehicle was EXPLICITLY chosen via the YMM picker, which stashes `_vehMake`.
  // This (not the template-default vehicleName) is what reveals the color
  // swatches, so a fresh creative never shows them without input.
  const vehicleChosen = useMemo(() => !!(data['_vehMake'] || data['o2__vehMake']), [data]);
  // …and its name resolves to a full "YYYY Make Model" so EVOX can look it up.
  const hasVehicle = useMemo(
    () =>
      vehicleSlots.some((slot) =>
        /^\d{4}\s+\S+\s+.+$/.test((data[slot.nameKey] ?? data.vehicleName ?? '').toString().trim()),
      ),
    [vehicleSlots, data],
  );
  const shownFields = useMemo(
    () => manualFields.filter((f) => isFieldVisible(f, data)),
    [manualFields, data],
  );

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Offer</h2>

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
                  dualVehicleMode === val ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Vehicle picker — sets vehicleName + the `_veh*` stash the disclaimer
            engine, co-op lookups and the color picker all read.

            Gated on `allowVehiclePicker`, NOT on `vehicleSlots`. Those are two
            different questions: the slots say whether the design draws a vehicle
            IMAGE, while the make drives the disclaimer, the OEM required fields
            and every co-op rule lookup. Tying them together meant a template with
            no image element quietly lost its make selector — and with it, all
            manufacturer checking. */}
        {allowVehiclePicker && (
          <ManualVehiclePicker
            initial={{
              year: data._vehYear,
              make: data._vehMake,
              model: data._vehModel,
              trim: data._vehTrim,
            }}
            defaultMake={oemMake}
            onChange={({ year, make, model, trim }) =>
              setData((d) => ({
                ...d,
                vehicleName: [year, make, model, trim].filter(Boolean).join(' '),
                _vehYear: year,
                _vehMake: make,
                _vehModel: model,
                _vehTrim: trim,
              }))
            }
          />
        )}
        {shownFields.length ? (
          shownFields.map((f) => (
            <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={allowVehiclePicker} />
          ))
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">This template has no editable offer fields.</p>
        )}
      </div>

      {/* Vehicle color — only once a vehicle has been EXPLICITLY chosen AND its
          name resolves. Template defaults never trigger it. */}
      {vehicleSlots.length > 0 && vehicleChosen && hasVehicle && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Vehicle color</h3>
          <div className="space-y-4">
            {vehicleSlots.map((slot) => {
              // The structured vehicle fields share the slot's prefix ('' / 'o2_')
              // with vehicleName. Pass them so the color lookup keeps trim out of
              // the model (see VehicleColorPicker).
              const p = slot.nameKey.replace(/vehicleName$/, '');
              return (
                <div key={slot.imageKey}>
                  {vehicleSlots.length > 1 && <div className="mb-1.5 text-[11px] font-medium text-[var(--foreground)]">{slot.label}</div>}
                  <VehicleColorPicker
                    vehicleName={data[slot.nameKey] ?? data.vehicleName ?? ''}
                    year={data[`${p}_vehYear`]}
                    make={data[`${p}_vehMake`]}
                    model={data[`${p}_vehModel`]}
                    trim={data[`${p}_vehTrim`]}
                    selectedCode={data[slot.codeKey] ?? ''}
                    onPick={(url, code) => setData((d) => ({ ...d, [slot.imageKey]: url, [slot.codeKey]: code }))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Year / Make / Model / Trim picker.
 *
 * TRIM MATTERS AND USED TO BE UNREACHABLE. `_vehTrim` was written only by the OEM
 * incentive apply, which took it from the MarketCheck row — there was no trim
 * input anywhere in Loomi. With the OEM tab gone that would have made trim
 * permanently uncapturable, while Subaru's guidelines require "year, model, trim"
 * and the full-length OEM disclaimer bodies render it through `{{vehicle}}`.
 *
 * Local state keeps the inputs snappy; every change is pushed up so `vehicleName`
 * and the `_veh*` stash stay in the ad data.
 */
function ManualVehiclePicker({
  initial,
  defaultMake,
  onChange,
}: {
  initial?: { year?: string; make?: string; model?: string; trim?: string };
  defaultMake?: string;
  onChange: (v: { year: string; make: string; model: string; trim: string }) => void;
}) {
  const [year, setYear] = useState(initial?.year || String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(initial?.make || defaultMake || '');
  const [model, setModel] = useState(initial?.model || '');
  const [trim, setTrim] = useState(initial?.trim || '');
  const yearOptions: SelectOption[] = EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: SelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];
  const inputClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
        Vehicle <span className="font-normal text-[var(--muted-foreground)]">— sets the vehicle + loads its colors below</span>
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={year} onChange={(v) => { setYear(v); onChange({ year: v, make, model, trim }); }} options={yearOptions} previewFont={false} />
        <Select value={make} onChange={(v) => { setMake(v); onChange({ year, make: v, model, trim }); }} options={makeOptions} previewFont={false} />
        <input
          value={model}
          onChange={(e) => { setModel(e.target.value); onChange({ year, make, model: e.target.value, trim }); }}
          placeholder="Model"
          className={inputClass}
        />
        <input
          value={trim}
          onChange={(e) => { setTrim(e.target.value); onChange({ year, make, model, trim: e.target.value }); }}
          placeholder="Trim (optional)"
          className={inputClass}
        />
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        Some manufacturers require the trim in the disclaimer — Subaru asks for year, model and trim.
      </p>
    </div>
  );
}
