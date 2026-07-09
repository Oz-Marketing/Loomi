'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import type { EvoxVehicle } from '@/lib/integrations/evox';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { EVOX_CURRENT_YEAR, EVOX_YEARS, EVOX_MAKES } from './evox-makes';

// A representative model per make so the Model placeholder matches the selected
// make (e.g. Subaru → Crosstrek) instead of a fixed, off-brand "Accord".
const MODEL_EXAMPLE: Record<string, string> = {
  Acura: 'MDX', 'Alfa Romeo': 'Giulia', Audi: 'Q5', BMW: 'X3', Buick: 'Enclave',
  Cadillac: 'Escalade', Chevrolet: 'Silverado', Chrysler: 'Pacifica', Dodge: 'Durango',
  Fiat: '500X', Ford: 'F-150', Genesis: 'GV70', GMC: 'Sierra', Honda: 'Accord',
  Hyundai: 'Tucson', Infiniti: 'QX60', Jaguar: 'F-PACE', Jeep: 'Grand Cherokee',
  Kia: 'Telluride', 'Land Rover': 'Defender', Lexus: 'RX', Lincoln: 'Corsair',
  Maserati: 'Grecale', Mazda: 'CX-5', 'Mercedes-Benz': 'GLC', MINI: 'Cooper',
  Mitsubishi: 'Outlander', Nissan: 'Rogue', Polestar: '2', Porsche: 'Cayenne',
  Ram: '1500', Rivian: 'R1S', Subaru: 'Crosstrek', Tesla: 'Model 3', Toyota: 'RAV4',
  Volkswagen: 'Tiguan', Volvo: 'XC90',
};

/**
 * OEM Incentives (MarketCheck) — look up the live lease / APR / cash programs
 * for a vehicle and apply one to auto-fill the structured offer fields. Manual
 * entry lives on the sibling tab; this is just a faster, accurate source.
 * Renders a "not configured" hint when MARKETCHECK_API_KEY is unset.
 */
export function OemIncentivesPanel({ defaultMake, defaultZip, dual, dualVehicleMode, accountKey, onApply }: { defaultMake?: string; defaultZip?: string; dual?: boolean; dualVehicleMode?: 'same' | 'two'; accountKey?: string; onApply: (patch: Record<string, string>) => void }) {
  const [year, setYear] = useState(String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(defaultMake || '');
  const [model, setModel] = useState('');
  // Seed from the account profile's postal code — the designer can still change it.
  const [zip, setZip] = useState(defaultZip ?? '');
  // Account data loads async; fill the ZIP once it arrives unless already typed.
  useEffect(() => {
    if (defaultZip) setZip((z) => z || defaultZip);
  }, [defaultZip]);
  const [busy, setBusy] = useState(false);
  const [incentives, setIncentives] = useState<MarketCheckIncentive[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  // When the feed fell back (previous model year / national search), tell the designer.
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  // True while fetching the EVOX jellybean for an applied incentive.
  const [resolvingImg, setResolvingImg] = useState(false);

  const yearOptions: FontSelectOption[] = EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: FontSelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];

  async function find() {
    if (!make) {
      toast.error('Pick a make');
      return;
    }
    setBusy(true);
    setIncentives(null);
    setNotConfigured(false);
    setFallbackNote(null);
    try {
      const res = await fetch('/api/ad-generator/marketcheck/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make, model: model.trim(), year: Number(year), zip: zip.trim() }),
      });
      const json = await res.json();
      if (json.configured === false) {
        setNotConfigured(true);
        setIncentives([]);
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setIncentives(json.incentives ?? []);
      const notes: string[] = [];
      if (json.usedYear && json.usedYear !== Number(year)) notes.push(`no ${year} programs yet — showing ${json.usedYear}`);
      if (json.usedNational) notes.push('none near that ZIP — showing national programs');
      setFallbackNote(notes.length ? notes.join('; ') : null);
    } catch (err) {
      toast.error(`MarketCheck lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setIncentives([]);
    } finally {
      setBusy(false);
    }
  }

  function apply(inc: MarketCheckIncentive, which: '' | 'o2_' = '') {
    const p = dual ? which : ''; // field prefix for the chosen offer slot
    const patch: Record<string, string> = {};
    if (inc.type === 'lease') {
      patch[`${p}offerType`] = 'lease';
      if (inc.payment) patch[`${p}monthlyPayment`] = String(Math.round(inc.payment));
      if (inc.term) patch[`${p}leaseTerm`] = String(inc.term);
      if (inc.downPayment) patch[`${p}dueAtSigning`] = String(Math.round(inc.downPayment));
    } else if (inc.type === 'apr') {
      patch[`${p}offerType`] = 'apr';
      patch[`${p}aprRate`] = String(inc.rate);
      if (inc.term) patch[`${p}aprTerm`] = String(inc.term);
    } else if (inc.type === 'cash') {
      patch[`${p}offerType`] = 'discount';
      if (inc.amount) patch[`${p}discountAmount`] = String(Math.round(inc.amount));
    }
    if (inc.msrp) patch[`${p}msrp`] = String(Math.round(inc.msrp));
    if (inc.endDate) {
      const d = new Date(inc.endDate);
      if (!Number.isNaN(d.getTime())) patch.expiration = d.toISOString().slice(0, 10); // shared
    }
    // We already know the vehicle from the search — fill it too (name now, EVOX
    // jellybean async). For a same-model dual, Offer 2 rides Offer 1's vehicle,
    // so don't overwrite it here.
    const setVehicle = !(dual && which === 'o2_' && dualVehicleMode === 'same');
    if (setVehicle && (make || model)) {
      patch[`${p}vehicleName`] = [year, make, model].filter(Boolean).join(' ');
      // Stash the structured vehicle so the EVOX color picker can seed + auto-search
      // it (no re-typing) — see evoxSeedFor().
      patch[`${p}_vehYear`] = String(year || '');
      patch[`${p}_vehMake`] = make || '';
      patch[`${p}_vehModel`] = model || '';
    }
    onApply(patch);
    toast.success(dual ? `Filled ${which === 'o2_' ? 'Offer 2' : 'Offer 1'} from the incentive` : 'Offer filled from the incentive');
    if (setVehicle && make) {
      setResolvingImg(true);
      resolveJellybean(make, model, Number(year))
        .then((url) => { if (url) onApply({ [`${p}vehicleImageUrl`]: url }); })
        .finally(() => setResolvingImg(false));
    }
  }

  // Auto-pull the EVOX jellybean for the searched vehicle: first matching trim +
  // its first color → resolve (which re-hosts to our S3, so it's cached).
  async function resolveJellybean(mk: string, mdl: string, yr: number): Promise<string | null> {
    try {
      const s = await fetch('/api/ad-generator/evox/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: yr, make: mk, model: mdl }) });
      const sj = await s.json().catch(() => ({}));
      const v = (sj.vehicles ?? [])[0] as EvoxVehicle | undefined;
      const color = v?.colors?.[0];
      if (!v || !color) return null;
      const r = await fetch('/api/ad-generator/evox/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vifnum: v.vifnum, colorCode: color.code, accountKey, hint: `${yr}-${mk}-${mdl}` }) });
      const rj = await r.json().catch(() => ({}));
      return typeof rj.url === 'string' ? rj.url : null;
    } catch {
      return null;
    }
  }

  const typeBadge: Record<string, string> = {
    lease: 'bg-blue-500/15 text-blue-500',
    apr: 'bg-emerald-500/15 text-emerald-500',
    cash: 'bg-amber-500/15 text-amber-500',
    other: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  };

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">
        Pull a current lease / APR / cash offer — applying one fills in the offer <span className="text-[var(--foreground)]">and</span> the vehicle for you.
      </p>
      {/* Two per row so the fields aren't scrunched in the narrow form column. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Year</label>
          <FontSelect value={year} onChange={setYear} options={yearOptions} previewFont={false} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Make</label>
          <FontSelect value={make} onChange={setMake} options={makeOptions} previewFont={false} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder={MODEL_EXAMPLE[make] ? `e.g. ${MODEL_EXAMPLE[make]}` : 'Model name'}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">ZIP</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder="Optional"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
      <button
        onClick={find}
        disabled={busy}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] disabled:opacity-50"
      >
        {busy ? 'Searching…' : 'Find incentives'}
      </button>

      {resolvingImg && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-3 w-3 animate-spin" /> Fetching vehicle image…
        </p>
      )}

      {notConfigured && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          MarketCheck isn’t configured here. Set <span className="font-mono">MARKETCHECK_API_KEY</span> to enable the incentive feed.
        </div>
      )}
      {incentives && incentives.length === 0 && !notConfigured && (
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">No incentives found for that vehicle.</p>
      )}
      {fallbackNote && incentives && incentives.length > 0 && (
        <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">{fallbackNote}</p>
      )}
      {incentives && incentives.length > 0 && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {incentives.map((inc, i) => (
            <div key={inc.id || i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${typeBadge[inc.type]}`}>{inc.type}</span>
                {/* Fill directly into the target offer — no separate "Apply to" toggle. */}
                <div className="flex items-center gap-1">
                  {dual ? (
                    <>
                      <button onClick={() => apply(inc, '')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                        Fill Offer 1
                      </button>
                      <button onClick={() => apply(inc, 'o2_')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                        Fill Offer 2
                      </button>
                    </>
                  ) : (
                    <button onClick={() => apply(inc, '')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                      Fill offer
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs font-medium text-[var(--foreground)]">{inc.offerDetails || inc.description}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--muted-foreground)]">
                {inc.payment > 0 && <span>${Math.round(inc.payment).toLocaleString()}/mo</span>}
                {inc.rate > 0 && <span>{inc.rate}% APR</span>}
                {inc.amount > 0 && <span>${Math.round(inc.amount).toLocaleString()} cash</span>}
                {inc.term > 0 && <span>{inc.term} mo</span>}
                {inc.downPayment > 0 && <span>${Math.round(inc.downPayment).toLocaleString()} DAS</span>}
                {inc.trim && <span>{inc.trim}</span>}
                {inc.endDate && <span>ends {inc.endDate.slice(0, 10)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
