'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';
import {
  BoltIcon,
  ChevronDownIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

/**
 * The one door into making a campaign.
 *
 * Three ways in — Loomi AI, by hand, or from this month's manufacturer offers —
 * behind a single button. Three side-by-side buttons in a page header make none
 * of them the obvious one, and the OEM route only exists for some accounts, so
 * the header's shape used to change from account to account.
 *
 * The sparkle and the gradient stay on the AI row only; the bolt marks the
 * automation. The trigger itself is a plain primary button — it is not an AI
 * control.
 */
export function CreateCampaignMenu({
  href,
  oemEligible,
  onRunOem,
  align = 'right',
}: {
  href: (p: string) => string;
  /** Show the manufacturer-offer route. Vehicle accounts only. */
  oemEligible: boolean;
  onRunOem: () => void;
  /** Which edge the menu hangs from. `center` is for the empty state. */
  align?: 'right' | 'center';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3.5 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:bg-[var(--primary)]/90"
      >
        <PlusIcon className="h-4 w-4" />
        Create campaign
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        // The wrapper does the positioning; `glass-dropdown` animates its own
        // transform, so a `-translate-x-1/2` on the menu itself would be
        // overwritten the moment the animation runs.
        <div
          className={`absolute top-full z-50 mt-1.5 flex ${
            align === 'center' ? 'left-0 w-full justify-center' : 'right-0'
          }`}
        >
          <div role="menu" className="glass-dropdown w-[19rem] p-1.5 text-left shadow-lg">
            <MenuRow
              icon={SparklesIcon}
              iconClass="iris-rainbow-gradient text-zinc-900"
              title="With Loomi AI"
              description="Answer a few questions and Loomi drafts every channel."
              href={href('/campaign-builder/new')}
              onDone={() => setOpen(false)}
            />
            <MenuRow
              icon={PencilSquareIcon}
              title="Manually"
              description="Pick the pieces you want and fill them in yourself."
              href={href('/campaign-builder/new/manual')}
              onDone={() => setOpen(false)}
            />
            {oemEligible && (
              <MenuRow
                icon={BoltIcon}
                title="From OEM offers"
                description="Build ad designs and the offer email from this month’s programs."
                onClick={onRunOem}
                onDone={() => setOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  icon: Icon,
  iconClass,
  title,
  description,
  href,
  onClick,
  onDone,
}: {
  icon: ComponentType<{ className?: string }>;
  /** Overrides the muted icon chip — the AI row wears the gradient. */
  iconClass?: string;
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  onDone: () => void;
}) {
  const body = (
    <>
      <span
        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
          iconClass ?? 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--muted-foreground)]">
          {description}
        </span>
      </span>
    </>
  );

  const cls =
    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--muted)]';

  if (href) {
    return (
      <Link role="menuitem" href={href} onClick={onDone} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onDone();
        onClick?.();
      }}
      className={cls}
    >
      {body}
    </button>
  );
}
