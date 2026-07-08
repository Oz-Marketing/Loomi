'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/account-context';
import type { EvoxVehicle, EvoxColor } from '@/lib/integrations/evox';

/** Approximate a display swatch color from an EVOX color's NAME — this product
 *  returns names ("Ice Silver Metallic") but no RGB, so we map keywords to a
 *  representative hex. Falls back to RGB when present, then a neutral chip. */
const COLOR_NAME_HEX: [RegExp, string][] = [
  [/white|ivory|frost/i, '#eceef0'],
  [/black|ebony|obsidian|midnight/i, '#1b1b1e'],
  [/silver|platinum|aluminum|titanium/i, '#c3c8cc'],
  [/gr[ae]y|graphite|magnetite|slate|charcoal|gunmetal|steel/i, '#8b9095'],
  [/red|crimson|scarlet|cardinal|garnet|ruby/i, '#c1201f'],
  [/blue|navy|azure|cobalt|indigo|teal/i, '#1e50a8'],
  [/green|emerald|olive|forest|lime/i, '#2f7d4f'],
  [/yellow|gold|amber/i, '#e3b23c'],
  [/orange|copper|sunset/i, '#d9682a'],
  [/brown|bronze|tan|beige|mocha|espresso|sand/i, '#7c6242'],
  [/purple|violet|plum|magenta/i, '#6a3d9a'],
  [/pink|rose/i, '#dd6a8f'],
];
export function colorNameToHex(c: EvoxColor): string {
  if (c.rgb) return `#${c.rgb.replace('#', '')}`;
  const hay = `${c.simple} ${c.name}`;
  for (const [re, hex] of COLOR_NAME_HEX) if (re.test(hay)) return hex;
  return '#cbd5e1';
}

type Swatch = { color: EvoxColor; candidates: { vifnum: number; code: string }[] };

/**
 * A single paint-color tile showing the ACTUAL EVOX jellybean, cover-cropped
 * and zoomed so the vehicle body fills the tile — this pushes the transparent
 * padding and the bottom-right EVOX watermark out of frame, so the tile reads
 * as the real paint color. Falls back to an approximated hex chip on 404.
 */
function JellybeanTile({ vifnum, code, color }: { vifnum: number; code: string; color: EvoxColor }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return <span className="block h-full w-full" style={{ background: colorNameToHex(color) }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/ad-generator/evox/thumb?vifnum=${vifnum}&color=${encodeURIComponent(code)}`}
      alt={color.name || color.code}
      loading="lazy"
      onError={() => setOk(false)}
      // cover + zoom crops the transparent margins and the bottom-right
      // watermark; object-position pulls toward the body's upper-left.
      className="h-full w-full object-cover"
      style={{ transform: 'scale(1.7)', objectPosition: '38% 32%' }}
    />
  );
}

/**
 * Client-facing vehicle color picker. The vehicle itself is already decided by
 * the chosen offer / OEM incentive (it lives in `vehicleName`), so clients
 * never search — they pick from the paint colors EVOX stocks for that vehicle.
 * Picking one resolves the transparent PNG (re-hosted server side) into the ad.
 * Swatches are laid out horizontally and show the real jellybean (cropped) so
 * the actual paint color is easy to read. Until an offer names a vehicle, it
 * shows a gentle hint instead of an empty grid.
 */
export function VehicleColorPicker({ vehicleName, selectedCode, onPick }: { vehicleName: string; selectedCode: string; onPick: (url: string, colorCode: string) => void }) {
  const { accountKey } = useAccount();
  // One entry per distinct color NAME, carrying every (vifnum, code) that offers
  // it — the same paint can appear under multiple trims/codes and only some
  // have a rendered image, so we try them in order when the user picks.
  const [swatches, setSwatches] = useState<Swatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  // Parse "2026 Honda Accord" → year / make / model (the shape the incentive
  // apply writes). Anything that doesn't match → no vehicle yet.
  const ymm = useMemo(() => {
    const m = vehicleName.trim().match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    return m ? { year: Number(m[1]), make: m[2], model: m[3] } : null;
  }, [vehicleName]);

  useEffect(() => {
    if (!ymm) {
      setSwatches(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotConfigured(false);
    fetch('/api/ad-generator/evox/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: ymm.year, make: ymm.make, model: ymm.model }),
    })
      .then((r) => r.json())
      .then((j: { configured?: boolean; vehicles?: EvoxVehicle[] }) => {
        if (cancelled) return;
        if (j.configured === false) {
          setNotConfigured(true);
          setSwatches([]);
          return;
        }
        // Group colors across every returned trim by full color NAME (EVOX
        // repeats a color across trims, and different codes can share a simple
        // label like "Silver"). Keep ALL (vifnum, code) pairs per name so a
        // pick can fall through to a trim that actually has the image.
        const byName = new Map<string, Swatch>();
        for (const v of j.vehicles ?? []) {
          for (const color of v.colors ?? []) {
            const key = (color.name || color.simple || color.code || '').toLowerCase();
            if (!key) continue;
            const entry = byName.get(key);
            if (entry) entry.candidates.push({ vifnum: v.vifnum, code: color.code });
            else byName.set(key, { color, candidates: [{ vifnum: v.vifnum, code: color.code }] });
          }
        }
        setSwatches([...byName.values()]);
      })
      .catch(() => {
        if (!cancelled) setSwatches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ymm]);

  async function pickColor(s: Swatch) {
    const c = s.color;
    setPicking(c.code);
    try {
      // Try each trim/code offering this color until one actually has an image
      // (some EVOX codes for the same paint return no rendered product).
      let picked: { url: string; code: string } | null = null;
      for (const cand of s.candidates) {
        const r = await fetch('/api/ad-generator/evox/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vifnum: cand.vifnum, colorCode: cand.code, accountKey, hint: `${vehicleName}-${c.simple || c.name || c.code}` }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.url) {
            picked = { url: j.url, code: cand.code };
            break;
          }
        }
      }
      if (!picked) throw new Error('No image available for that color');
      onPick(picked.url, picked.code);
      toast.success('Color updated');
    } catch (err) {
      toast.error(`Couldn't switch color: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setPicking(null);
    }
  }

  if (!ymm) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
        Choose an offer above to load your vehicle, then pick a color.
      </p>
    );
  }
  if (loading) return <p className="text-xs text-[var(--muted-foreground)]">Loading colors for {vehicleName}…</p>;
  if (notConfigured) return <p className="text-xs text-[var(--muted-foreground)]">Vehicle imagery isn’t available in this environment.</p>;
  if (!swatches || !swatches.length) return <p className="text-xs text-[var(--muted-foreground)]">No stock colors found for {vehicleName}.</p>;

  return (
    <div className="flex flex-wrap gap-3">
      {swatches.map((s) => {
        const c = s.color;
        const label = c.name || c.simple || c.code;
        const selected = !!selectedCode && s.candidates.some((cand) => cand.code === selectedCode);
        const busy = picking === c.code;
        return (
          <button
            key={label}
            type="button"
            onClick={() => pickColor(s)}
            disabled={picking !== null}
            title={label}
            className="group flex w-16 flex-col items-center gap-1 disabled:opacity-60"
          >
            <span
              className={`relative block h-16 w-16 overflow-hidden rounded-lg border bg-[var(--muted)]/40 transition-all ${
                selected ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/40' : 'border-[var(--border)] group-hover:border-[var(--primary)]'
              }`}
            >
              <JellybeanTile vifnum={s.candidates[0].vifnum} code={s.candidates[0].code} color={c} />
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/70 text-[10px] font-medium text-[var(--primary)]">…</span>
              )}
            </span>
            <span className="w-full truncate text-center text-[10px] font-medium text-[var(--muted-foreground)]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
