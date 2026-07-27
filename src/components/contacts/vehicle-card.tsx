'use client';

import { useMemo, useState } from 'react';

// Vehicle "garage" card for automotive contacts. A contact can own several
// vehicles over time (each service visit / purchase carries its own), so this
// shows the primary vehicle with its EVOX jellybean plus a switcher for the
// rest. Falls back to an icon whenever EVOX has no match.

export interface GarageVehicle {
  year?: string;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: string;
  color?: string;
  /** Most recent service date seen for this specific vehicle. */
  lastServiceDate?: string;
  /** Purchase date for this specific vehicle. */
  purchaseDate?: string;
}

interface VehicleCardProps {
  vehicles: GarageVehicle[];
  /** Contact-level lifecycle, shown alongside the primary vehicle. */
  leaseEndDate?: string;
  warrantyEndDate?: string;
  dealType?: string;
}

function fmtDate(s?: string): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMiles(s?: string): string {
  const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
  return n > 0 ? `${n.toLocaleString()} mi` : '';
}

function vehicleTitle(v: GarageVehicle): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ').trim() || 'Vehicle';
}

function imageSrc(v: GarageVehicle): string | null {
  if (!v.year || !v.make || !v.model) return null;
  const p = new URLSearchParams({ year: v.year, make: v.make, model: v.model });
  if (v.color) p.set('color', v.color);
  return `/api/vehicle-image?${p.toString()}`;
}

export function VehicleCard({ vehicles, leaseEndDate, warrantyEndDate, dealType }: VehicleCardProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});

  const active = vehicles[index] ?? vehicles[0];
  const src = useMemo(() => (active ? imageSrc(active) : null), [active]);

  if (!active) return null;

  const specs = [
    { label: 'VIN', value: active.vin || '', mono: true },
    { label: 'Mileage', value: fmtMiles(active.mileage), mono: false },
    { label: 'Color', value: active.color || '', mono: false },
  ].filter((s) => s.value);

  const lifecycle = [
    { label: 'Last Service', value: fmtDate(active.lastServiceDate) },
    { label: 'Purchased', value: fmtDate(active.purchaseDate) },
    { label: 'Deal Type', value: dealType || '' },
    { label: 'Lease Ends', value: fmtDate(leaseEndDate) },
    { label: 'Warranty Ends', value: fmtDate(warrantyEndDate) },
  ].filter((l) => l.value);

  return (
    <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
          {vehicles.length > 1 ? `Garage · ${vehicles.length} vehicles` : 'Vehicle'}
        </h3>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Jellybean */}
        <div className="relative flex h-[130px] w-full shrink-0 items-center justify-center sm:w-[220px]">
          {src && !failed[index] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={vehicleTitle(active)}
              className="max-h-[96%] max-w-[96%] object-contain drop-shadow"
              onError={() => setFailed((f) => ({ ...f, [index]: true }))}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-[var(--muted-foreground)]">
              <CarGlyph />
              <span className="text-[10px]">No image</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-lg font-semibold text-[var(--foreground)]">
              {vehicleTitle(active)}
            </h4>
            {active.color && (
              <span className="rounded-full border border-[var(--border)]/60 px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                {active.color}
              </span>
            )}
          </div>

          {specs.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {specs.map((s) => (
                <div key={s.label} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    {s.label}
                  </div>
                  <div
                    className={`truncate text-sm text-[var(--foreground)] ${s.mono ? 'font-mono text-[13px]' : ''}`}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {lifecycle.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {lifecycle.map((l) => (
                <span
                  key={l.label}
                  className="inline-flex flex-col rounded-lg border border-[var(--border)]/40 bg-[var(--muted)]/25 px-2.5 py-1"
                >
                  <span className="text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    {l.label}
                  </span>
                  <span className="text-xs text-[var(--foreground)]">{l.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Garage switcher */}
      {vehicles.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border)]/40 pt-3">
          {vehicles.map((v, i) => (
            <button
              key={`${v.vin || vehicleTitle(v)}-${i}`}
              onClick={() => setIndex(i)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                i === index
                  ? 'border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--foreground)]'
                  : 'border-[var(--border)]/50 text-[var(--muted-foreground)] hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]'
              }`}
            >
              {vehicleTitle(v)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CarGlyph() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 13l1.6-4.2A2 2 0 0 1 7.5 7.5h9a2 2 0 0 1 1.9 1.3L20 13" />
      <path d="M3.5 13h17v3.2a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1v-.7H7.9v.7a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V13z" />
      <circle cx="8" cy="15" r="0.6" />
      <circle cx="16" cy="15" r="0.6" />
    </svg>
  );
}
