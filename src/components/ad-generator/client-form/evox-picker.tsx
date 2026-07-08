'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, MagnifyingGlassIcon, TruckIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import type { EvoxVehicle, EvoxColor } from '@/lib/integrations/evox';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from './evox-makes';

/** A color swatch that shows the ACTUAL jellybean via the thumbnail proxy (EVOX
 *  search returns no swatch image/hex), falling back to a hex/grey chip on 404. */
export function EvoxColorSwatch({ vifnum, color }: { vifnum: number; color: EvoxColor }) {
  const [ok, setOk] = useState(true);
  if (ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/ad-generator/evox/thumb?vifnum=${vifnum}&color=${encodeURIComponent(color.code)}`}
        alt={color.name || color.code}
        loading="lazy"
        onError={() => setOk(false)}
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  return <span className="h-6 w-6 rounded-full border border-[var(--border)]" style={{ background: color.rgb ? `#${color.rgb.replace('#', '')}` : '#cbd5e1' }} />;
}

/** EVOX vehicle picker: search Year/Make/Model → pick a trim + color → image.
 *  `initial` seeds Year/Make/Model from the already-selected vehicle (e.g. a
 *  MarketCheck offer) so you don't re-enter it — it auto-searches on open. */
export function EvoxPickerModal({ onClose, onPick, initial }: { onClose: () => void; onPick: (url: string) => void; initial?: { year?: string; make?: string; model?: string } }) {
  const { accountKey } = useAccount();
  const [year, setYear] = useState(initial?.year || String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(initial?.make || '');
  const [model, setModel] = useState(initial?.model || '');
  const [trim, setTrim] = useState('');
  const [busy, setBusy] = useState(false);
  const [vehicles, setVehicles] = useState<EvoxVehicle[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  // Seeded from a selected vehicle → run the search immediately so the color
  // options appear without the user re-typing the vehicle.
  useEffect(() => {
    if (initial?.make && initial?.model) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yearOptions: FontSelectOption[] = EVOX_YEARS.map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: FontSelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];

  async function search() {
    if (!make || !model.trim()) {
      toast.error('Pick a make and enter a model');
      return;
    }
    setBusy(true);
    setVehicles(null);
    setNotConfigured(false);
    try {
      const res = await fetch('/api/ad-generator/evox/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: Number(year), make, model: model.trim(), trim: trim.trim() }),
      });
      const json = await res.json();
      if (json.configured === false) {
        setNotConfigured(true);
        setVehicles([]);
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setVehicles(json.vehicles ?? []);
    } catch (err) {
      toast.error(`EVOX search failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setVehicles([]);
    } finally {
      setBusy(false);
    }
  }

  async function pick(v: EvoxVehicle, color: EvoxColor) {
    const id = `${v.vifnum}-${color.code}`;
    setPicking(id);
    try {
      const res = await fetch('/api/ad-generator/evox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vifnum: v.vifnum,
          colorCode: color.code,
          accountKey,
          hint: `${v.year}-${v.make}-${v.model}-${color.simple || color.name || color.code}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onPick(json.url);
      toast.success('Vehicle image added');
    } catch (err) {
      toast.error(`Couldn't add image: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setPicking(null);
    }
  }

  // Portal to body so the overlay covers the viewport — a backdrop-blur
  // ancestor (the form cards) otherwise becomes the containing block for
  // `fixed` and traps the modal inside the card.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <TruckIcon className="h-4 w-4 text-[var(--primary)]" />
              Find a vehicle
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">EVOX transparent-PNG photography. Pick a trim + color to drop it into the ad.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <FontSelect value={year} onChange={setYear} options={yearOptions} previewFont={false} />
          <FontSelect value={make} onChange={setMake} options={makeOptions} previewFont={false} />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Model (e.g. F-150)"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <input
            value={trim}
            onChange={(e) => setTrim(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Trim (optional)"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <button
          onClick={search}
          disabled={busy}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <MagnifyingGlassIcon className="h-4 w-4" />
          {busy ? 'Searching…' : 'Search'}
        </button>

        <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto">
          {notConfigured && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-600 dark:text-amber-400">
              EVOX isn’t configured in this environment. Set <span className="font-mono">EVOX_API_KEY</span> to enable the vehicle picker.
            </div>
          )}
          {vehicles && vehicles.length === 0 && !notConfigured && (
            <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
              No matches — double-check the make/model spelling (EVOX is exact).
            </p>
          )}
          {vehicles?.map((v) => (
            <div key={v.vifnum}>
              <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">
                {v.year} {v.make} {v.model} <span className="font-normal text-[var(--muted-foreground)]">· {v.trim}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {v.colors.map((c) => {
                  const id = `${v.vifnum}-${c.code}`;
                  const isPicking = picking === id;
                  return (
                    <button
                      key={c.code}
                      onClick={() => pick(v, c)}
                      disabled={picking !== null}
                      title={c.name || c.code}
                      className="group relative overflow-hidden rounded-lg border border-[var(--border)] p-1.5 text-left transition-colors hover:border-[var(--primary)] disabled:opacity-60"
                    >
                      <div className="flex h-16 items-center justify-center rounded bg-[var(--muted)]/40">
                        <EvoxColorSwatch vifnum={v.vifnum} color={c} />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="h-3 w-3 flex-shrink-0 rounded-full border border-[var(--border)]" style={{ background: c.rgb ? `#${c.rgb.replace('#', '')}` : 'transparent' }} />
                        <span className="truncate text-[10px] text-[var(--muted-foreground)]">{c.simple || c.name || c.code}</span>
                      </div>
                      {isPicking && (
                        <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/70 text-[10px] font-medium text-[var(--primary)]">Adding…</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
