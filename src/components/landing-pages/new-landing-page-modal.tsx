'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDaysIcon,
  CursorArrowRaysIcon,
  MegaphoneIcon,
  RocketLaunchIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LP_TEMPLATE_PRESETS, type LandingPageTemplatePreset } from '@/lib/landing-pages/templates';

const ICON_MAP: Record<LandingPageTemplatePreset['icon'], React.ComponentType<{ className?: string }>> = {
  sparkles: SparklesIcon,
  'cursor-arrow-rays': CursorArrowRaysIcon,
  'rocket-launch': RocketLaunchIcon,
  'calendar-days': CalendarDaysIcon,
  megaphone: MegaphoneIcon,
};

interface NewLandingPageModalProps {
  open: boolean;
  onClose: () => void;
  accountKey: string | null;
}

/**
 * Template picker for "New Landing Page". POSTs straight to
 * /api/landing-pages with `templateId` — the API hydrates the preset
 * schema and returns the new page + a `redirect` hint
 * (`'edit'` for blank, `'overview'` for templated).
 */
export function NewLandingPageModal({
  open,
  onClose,
  accountKey,
}: NewLandingPageModalProps) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const [name, setName] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string>('lead-capture');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName('');
      setSelectedId('lead-capture');
      setSubmitting(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const selected = LP_TEMPLATE_PRESETS.find((p) => p.id === selectedId);
  const canSubmit = !!accountKey && !!selected && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !accountKey || !selected) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          name: name.trim() || selected.name,
          templateId: selected.id,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not create landing page.');
        setSubmitting(false);
        return;
      }
      const target =
        payload.redirect === 'edit'
          ? subHref(`/websites/landing-pages/${payload.page.id}/edit`)
          : subHref(`/websites/landing-pages/${payload.page.id}`);
      router.push(target);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create landing page.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="glass-modal w-[640px] max-w-[calc(100vw-3rem)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Create a landing page</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Pick a starting point — every block is editable in the builder afterward.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label="Close"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Name{' '}
              <span className="text-[var(--muted-foreground)] normal-case font-normal">
                (optional)
              </span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selected?.name || 'Untitled landing page'}
              autoFocus
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Starting point
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LP_TEMPLATE_PRESETS.map((tpl) => {
                const Icon = ICON_MAP[tpl.icon];
                const active = selectedId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedId(tpl.id)}
                    className={`text-left rounded-xl border-2 p-3.5 flex items-start gap-3 transition-all ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
                        : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        active
                          ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                          : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{tpl.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
                        {tpl.description}
                      </p>
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1 tabular-nums">
                        {tpl.meta}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 h-10 text-sm font-semibold rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? 'Creating…'
              : selectedId === 'blank'
                ? 'Create + open builder'
                : 'Create landing page'}
          </button>
        </footer>
      </div>
    </div>
  );
}
