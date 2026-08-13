'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardIcon, LinkIcon, NoSymbolIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { HelpTip } from '@/components/ui/help-tip';

/**
 * Shareable links for one asset.
 *
 * Handing an asset to a dealer, a vendor or a printer previously meant an
 * account or an email attachment. Neither scales, and re-attaching on every
 * revision is how stale creative ends up in print.
 *
 * Revoked links stay listed. "Who shared this, and when did we pull it" is the
 * record the row exists for, and hiding it would make the list look tidy at the
 * cost of the only history there is.
 */

interface PublicLink {
  token: string;
  path: string;
  label: string | null;
  state: 'active' | 'revoked' | 'expired';
  expiresAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

const STATE_STYLE: Record<PublicLink['state'], string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  revoked: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  expired: 'bg-amber-500/15 text-amber-400',
};

export function PublicLinkPanel({
  assetId,
  /** Inherited assets are read-only here, so sharing is hidden. */
  readOnly = false,
}: {
  assetId: string;
  readOnly?: boolean;
}) {
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/public-link`);
      if (res.ok) setLinks((await res.json()).links || []);
    } catch {
      /* the panel is supplementary — don't break the drawer over it */
    }
    setLoading(false);
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/public-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Could not create a link');
      } else {
        await copy(data.link.path, 'Link created and copied');
        await load();
      }
    } catch {
      toast.error('Could not create a link');
    }
    setBusy(false);
  }

  async function copy(path: string, message = 'Link copied') {
    // Absolute, because the whole point is pasting it somewhere else.
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(message);
    } catch {
      // Clipboard access can be denied; showing the URL still lets someone copy
      // it by hand rather than leaving them stuck.
      toast.error(`Copy failed — the link is ${url}`);
    }
  }

  async function revoke(token: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/media/${encodeURIComponent(assetId)}/public-link?token=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error();
      toast.success('Link revoked — anyone holding it now gets a 404');
      await load();
    } catch {
      toast.error('Could not revoke that link');
    }
    setBusy(false);
  }

  const active = links.filter((l) => l.state === 'active');

  return (
    <div className="pt-3 border-t border-[var(--border)]">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          Sharing
          <HelpTip title="Public links">
            <p>
              A link anyone can open without a Loomi account — for a dealer, a
              vendor or a printer. It doesn&apos;t expire unless you say so, and you
              can revoke it.
            </p>
            <p className="mt-2">
              Worth knowing: the stored file itself is publicly readable, so
              revoking stops anyone holding the LINK, not someone who saved the
              direct file URL.
            </p>
          </HelpTip>
        </h4>
        {!readOnly && (
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {busy ? 'Working…' : 'Create link'}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
          No shareable links yet.
        </p>
      ) : (
        <div className="space-y-1">
          {links.map((l) => (
            <div
              key={l.token}
              className="flex items-center gap-2 rounded-lg bg-[var(--muted)]/40 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[10px] text-[var(--foreground)]">{l.path}</p>
                <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                  {l.label ? `${l.label} · ` : ''}
                  {/* An access count is the cheap answer to "is this actually
                      being used?" — worth showing before someone revokes. */}
                  {l.accessCount} view{l.accessCount === 1 ? '' : 's'}
                  {l.createdByName ? ` · ${l.createdByName}` : ''}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATE_STYLE[l.state]}`}>
                {l.state}
              </span>
              {l.state === 'active' && (
                <>
                  <button
                    type="button"
                    onClick={() => copy(l.path)}
                    title="Copy link"
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <ClipboardIcon className="h-3.5 w-3.5" />
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => revoke(l.token)}
                      disabled={busy}
                      title="Revoke link"
                      className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    >
                      <NoSymbolIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <p className="mt-2 text-[10px] leading-snug text-[var(--muted-foreground)]">
          {active.length} active link{active.length === 1 ? '' : 's'} — anyone with the
          URL can view this file.
        </p>
      )}
    </div>
  );
}
