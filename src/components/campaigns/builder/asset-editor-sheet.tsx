'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { CampaignAssetKind } from '@/lib/campaigns/types';
import { CHANNEL_META } from './shared';

/**
 * Opening a campaign's asset used to mean leaving the campaign: a link to the
 * blast builder, the landing-page builder, the flow canvas, the Ad Generator —
 * each a full page, each with its own way back to somewhere that wasn't here.
 *
 * The builders are the right editors and none of them is worth rebuilding as a
 * panel, so the real one opens over the campaign at full size and the campaign
 * is still underneath when it closes. It runs in `embed` mode, which drops the
 * app's sidebar and utility bar — the sheet's own bar carries the way back, the
 * asset's name, and a link to the same editor as an ordinary page for anyone
 * who wants it in a tab of its own.
 */

export interface AssetEditorTarget {
  kind: CampaignAssetKind;
  id: string;
  name?: string;
  /** The editor's ordinary URL. `embed=1` is added for the frame. */
  href: string;
}

interface AssetEditorApi {
  open: (target: AssetEditorTarget) => void;
}

const Ctx = createContext<AssetEditorApi | null>(null);

/**
 * Null outside a provider — the design grid and the email gallery are also
 * used away from the campaign detail, and there they should navigate.
 */
export function useAssetEditor(): AssetEditorApi | null {
  return useContext(Ctx);
}

/** Add the flag the app shell reads to drop its chrome. */
export function embedUrl(href: string): string {
  const [path, hash] = href.split('#');
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}embed=1${hash ? `#${hash}` : ''}`;
}

export function AssetEditorProvider({
  children,
  onClosed,
}: {
  children: ReactNode;
  /** Fired when the sheet closes, so the campaign can refetch what changed. */
  onClosed?: () => void;
}) {
  const [target, setTarget] = useState<AssetEditorTarget | null>(null);

  const open = useCallback((t: AssetEditorTarget) => setTarget(t), []);
  const api = useMemo(() => ({ open }), [open]);

  const close = useCallback(() => {
    setTarget(null);
    onClosed?.();
  }, [onClosed]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {target && <AssetEditorSheet target={target} onClose={close} />}
    </Ctx.Provider>
  );
}

function AssetEditorSheet({ target, onClose }: { target: AssetEditorTarget; onClose: () => void }) {
  const meta = CHANNEL_META[target.kind];
  const Icon = meta.Icon;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only when the focus is out here — inside the frame the editor owns the
      // key, and Escape there usually closes its own popover.
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="animate-modal-in fixed inset-0 z-[300] flex flex-col bg-[var(--background)]">
      <header className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)] px-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to campaign
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${meta.tone}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {target.name || meta.label}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <a
            href={target.href}
            target="_blank"
            rel="noreferrer"
            title="Open as a full page in a new tab"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Open in a tab <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the editor"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <iframe
        // `name` survives navigation inside the frame, so the shell keeps its
        // chrome off when the editor links on to its own next step.
        name="loomi-embed"
        title={target.name || meta.label}
        src={embedUrl(target.href)}
        className="min-h-0 w-full flex-1 border-0 bg-[var(--background)]"
      />
    </div>
  );
}

/**
 * The "Open" affordance for one asset. A plain click raises the sheet; a
 * modified click (or a middle click) is left alone, so cmd-click still opens
 * the editor in a real tab.
 */
export function OpenAssetLink({
  kind,
  id,
  name,
  href,
  className,
  children,
}: {
  kind: CampaignAssetKind;
  id: string;
  name?: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const editor = useAssetEditor();
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!editor || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        editor.open({ kind, id, name, href });
      }}
      className={className}
    >
      {children}
    </a>
  );
}
