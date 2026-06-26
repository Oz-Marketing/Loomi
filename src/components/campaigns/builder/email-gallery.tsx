'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowTopRightOnSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { AssetStatusBadge, assetEditorPath } from './shared';
import { EmailPreviewThumb } from './email-preview-thumb';
import type { CampaignAssetSummary } from '@/lib/campaigns/types';

/**
 * Emails tab: shows ONE email at a time with a desktop/mobile preview toggle and
 * a dot pager to move between emails — instead of stacking every email.
 */
export function CampaignEmailGallery({
  assets,
  href,
}: {
  assets: CampaignAssetSummary[];
  href: (path: string) => string;
}) {
  const [index, setIndex] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const safeIndex = Math.min(index, assets.length - 1);
  const active = assets[safeIndex];
  if (!active) return null;

  // Open the rendered email HTML full-page in a new browser tab.
  const viewInBrowser = () => {
    if (!active.renderedHtml) return;
    const blob = new Blob([active.renderedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const deviceBtn = (value: 'desktop' | 'mobile', Icon: typeof ComputerDesktopIcon, label: string) => {
    const isActive = device === value;
    return (
      <button
        type="button"
        onClick={() => setDevice(value)}
        title={label}
        aria-label={label}
        aria-pressed={isActive}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
          isActive ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  };

  return (
    <div>
      {/* Header: active email name + status + device toggle + open */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{active.name}</p>
          <AssetStatusBadge status={active.status} />
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-0.5">
            {deviceBtn('desktop', ComputerDesktopIcon, 'Desktop preview')}
            {deviceBtn('mobile', DevicePhoneMobileIcon, 'Mobile preview')}
          </div>
          {active.renderedHtml && (
            <button
              type="button"
              onClick={viewInBrowser}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              <EyeIcon className="h-3.5 w-3.5" /> View in browser
            </button>
          )}
          <Link
            href={assetEditorPath(href, 'email', active.id)}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition hover:underline"
          >
            Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Preview */}
      {active.renderedHtml ? (
        // Remount on email/device change so the iframe re-measures cleanly.
        <EmailPreviewThumb key={`${active.id}-${device}`} html={active.renderedHtml} device={device} maxHeight={620} />
      ) : (
        <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No preview available — open the email to add content.
        </div>
      )}

      {/* Pager */}
      {assets.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            className="text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-30"
            aria-label="Previous email"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5">
            {assets.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Email ${i + 1}`}
                aria-current={i === safeIndex}
                className={`h-2 rounded-full transition-all ${
                  i === safeIndex ? 'w-5 bg-[var(--primary)]' : 'w-2 bg-[var(--border)] hover:bg-[var(--muted-foreground)]'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIndex(Math.min(assets.length - 1, safeIndex + 1))}
            disabled={safeIndex === assets.length - 1}
            className="text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-30"
            aria-label="Next email"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
          <span className="ml-1 text-xs tabular-nums text-[var(--muted-foreground)]">
            {safeIndex + 1} / {assets.length}
          </span>
        </div>
      )}
    </div>
  );
}
