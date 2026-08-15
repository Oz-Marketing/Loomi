'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/**
 * Confirm which Page this sub-account publishes FROM.
 *
 * Reporting only ever needed the ad account. Publishing needs a Page: a Meta ad
 * creative cannot be created without `object_story_spec.page_id`, so a rooftop
 * with none can't be launched at all.
 *
 * It is a per-rooftop CONFIRMATION rather than a match. Across a 38-rooftop
 * multi-brand group the wrong Page publishes a Ford store's ad from the Chevy
 * store's Page — a brand incident that is invisible until somebody spots it in the
 * feed — and picking by name similarity is exactly the guess that produces it. So
 * a person chooses from what the token can actually see, and the choice is
 * attributed.
 */

interface AssetOption {
  id: string;
  name: string;
}

interface Confirmed {
  metaAdAccountId: string | null;
  metaPageId: string | null;
  metaInstagramActorId: string | null;
  metaPixelId: string | null;
  metaDefaultConversionEvent: string | null;
  metaAssetsConfirmedBy: string | null;
  metaAssetsConfirmedAt: string | null;
}

interface Assets {
  pages: AssetOption[];
  instagramAccounts: AssetOption[];
  pixels: AssetOption[];
  errors: Record<string, string>;
}

/**
 * Options for a select that must still show a SAVED id discovery didn't return.
 *
 * Without this, a token that temporarily can't see a Page makes a correctly
 * configured rooftop look unconfigured — and the obvious next move (re-pick) is
 * impossible because the list is empty.
 */
function withSaved(options: AssetOption[], savedId: string | null): AssetOption[] {
  if (!savedId || options.some((o) => o.id === savedId)) return options;
  return [{ id: savedId, name: `${savedId} (saved — not visible to the token right now)` }, ...options];
}

/**
 * One field: a picker when Meta can be read, a plain id box when it can't.
 *
 * The fallback is the point. When discovery is unavailable — no token in this
 * environment, an expired one, a permissions gap — hiding the field entirely means
 * an admin can't see what's configured, and can't correct a wrong Page at exactly
 * the moment they most need to. So it degrades to typing the id rather than to a
 * dead end.
 */
function AssetField({
  label,
  hint,
  required,
  value,
  onChange,
  options,
  savedId,
  emptyLabel,
  manual,
  disabled,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: AssetOption[];
  savedId: string | null;
  emptyLabel: string;
  manual: boolean;
  disabled: boolean;
}) {
  const control =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-[var(--foreground)]">
        {label}{' '}
        <span className="font-normal text-[var(--muted-foreground)]">({required ? 'required' : 'optional'})</span>
      </span>
      {manual ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          placeholder="Paste the id from Meta"
          className={control}
        />
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={control}>
          <option value="">{emptyLabel}</option>
          {withSaved(options, savedId).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.name.includes(o.id) ? '' : ` · ${o.id}`}
            </option>
          ))}
        </select>
      )}
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{hint}</span>}
    </label>
  );
}

export function MetaPublishingCard({ accountKey }: { accountKey: string }) {
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pageId, setPageId] = useState('');
  const [igId, setIgId] = useState('');
  const [pixelId, setPixelId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ad-generator/launch/meta-assets/${encodeURIComponent(accountKey)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const d = (await res.json()) as { confirmed: Confirmed; assets: Assets; blocked: string | null };
      setConfirmed(d.confirmed);
      setAssets(d.assets);
      setBlocked(d.blocked);
      setPageId(d.confirmed.metaPageId ?? '');
      setIgId(d.confirmed.metaInstagramActorId ?? '');
      setPixelId(d.confirmed.metaPixelId ?? '');
    } catch (err) {
      setBlocked(err instanceof Error ? err.message : 'Could not read Meta assets.');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ad-generator/launch/meta-assets/${encodeURIComponent(accountKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaPageId: pageId || null,
          metaInstagramActorId: igId || null,
          metaPixelId: pixelId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const d = (await res.json()) as { confirmed: Confirmed };
      setConfirmed(d.confirmed);
      toast.success(pageId ? 'Publishing identity confirmed' : 'Publishing identity cleared');
    } catch (err) {
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    (confirmed?.metaPageId ?? '') !== pageId ||
    (confirmed?.metaInstagramActorId ?? '') !== igId ||
    (confirmed?.metaPixelId ?? '') !== pixelId;
  const edgeErrors = Object.entries(assets?.errors ?? {});

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
            Publishing identity
            {confirmed?.metaPageId && <CheckCircleIcon className="h-4 w-4 text-emerald-500" />}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            Which Page this sub-account&apos;s ads are published from. Required to launch to Meta from
            Loomi — a Meta ad creative can&apos;t be created without a Page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          title="Re-read from Meta"
          className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {/* Shown as CONTEXT above the fields rather than instead of them — see
            AssetField. Being unable to list Pages is a reason to type the id, not
            a reason to hide what's already set. */}
        {blocked && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-[var(--muted-foreground)]">
            {blocked} You can still enter ids by hand.
          </div>
        )}

        <AssetField
          label="Facebook Page"
          required
          // Named explicitly because it is the mistake that matters and it is
          // silent: a wrong Page publishes under another store's brand.
          hint="Check this is the right store's Page — ads publish under whichever one is set here."
          value={pageId}
          onChange={setPageId}
          options={assets?.pages ?? []}
          savedId={confirmed?.metaPageId ?? null}
          emptyLabel={loading ? 'Loading…' : 'Not set — pick the Page for this rooftop'}
          manual={!!blocked}
          disabled={loading || saving}
        />

        <AssetField
          label="Instagram account"
          value={igId}
          onChange={setIgId}
          options={assets?.instagramAccounts ?? []}
          savedId={confirmed?.metaInstagramActorId ?? null}
          emptyLabel="Facebook placements only"
          manual={!!blocked}
          disabled={loading || saving}
        />

        <AssetField
          label="Pixel"
          value={pixelId}
          onChange={setPixelId}
          options={assets?.pixels ?? []}
          savedId={confirmed?.metaPixelId ?? null}
          emptyLabel="None — traffic campaigns only"
          manual={!!blocked}
          disabled={loading || saving}
        />

        <>
          {/* Partial results are useful, so a permission gap on one edge is
              reported rather than presented as "nothing found". */}
          {edgeErrors.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
                <ExclamationTriangleIcon className="h-3.5 w-3.5 text-amber-500" />
                Some lists couldn&apos;t be read
              </div>
              <ul className="mt-1 space-y-0.5 text-[var(--muted-foreground)]">
                {edgeErrors.map(([edge, msg]) => (
                  <li key={edge}>
                    · {edge}: {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {confirmed?.metaAssetsConfirmedAt
                ? `Confirmed by ${confirmed.metaAssetsConfirmedBy ?? 'unknown'} on ${new Date(
                    confirmed.metaAssetsConfirmedAt,
                  ).toLocaleDateString()}`
                : 'Not confirmed yet'}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !dirty}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </>
      </div>
    </div>
  );
}
