'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import useSWR from 'swr';
import {
  ArchiveBoxArrowDownIcon,
  CalendarDaysIcon,
  CodeBracketIcon,
  CursorArrowRaysIcon,
  MegaphoneIcon,
  RocketLaunchIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LP_TEMPLATE_PRESETS, type LandingPageTemplatePreset } from '@/lib/landing-pages/templates';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';
import type { LandingPageContent } from '@/lib/landing-pages/types';

interface AccountTemplate {
  id: string;
  name: string;
  description: string | null;
  schema: LandingPageContent;
  createdAt: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

const ICON_MAP: Record<LandingPageTemplatePreset['icon'], React.ComponentType<{ className?: string }>> = {
  sparkles: SparklesIcon,
  'cursor-arrow-rays': CursorArrowRaysIcon,
  'rocket-launch': RocketLaunchIcon,
  'calendar-days': CalendarDaysIcon,
  megaphone: MegaphoneIcon,
  'code-bracket': CodeBracketIcon,
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

  // Account-saved templates. Only fetched while the modal is open
  // and we have an accountKey to scope by — saves a request on the
  // common case of the modal being mounted but closed.
  const { data: tplData, mutate: refetchTemplates } = useSWR<{
    pages: { id: string; name: string; schema: LandingPageContent; createdAt: string }[];
  }>(
    open && accountKey
      ? `/api/landing-pages?isTemplate=true&accountKey=${encodeURIComponent(accountKey)}`
      : null,
    fetcher,
  );
  const accountTemplates: AccountTemplate[] = React.useMemo(
    () => (tplData?.pages ?? []).map((p) => ({ id: p.id, name: p.name, description: null, schema: p.schema, createdAt: p.createdAt })),
    [tplData],
  );

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

  // selectedId can resolve to either a built-in preset OR an
  // account template (encoded as "account:<uuid>"). Both shapes
  // expose `name` + `description` which is all the modal body
  // needs after selection.
  const selectedAccountTemplate =
    selectedId.startsWith('page:')
      ? accountTemplates.find((t) => `page:${t.id}` === selectedId)
      : null;
  const selectedPreset = !selectedAccountTemplate
    ? LP_TEMPLATE_PRESETS.find((p) => p.id === selectedId)
    : null;
  const selected = selectedAccountTemplate ?? selectedPreset;
  const canSubmit = !!accountKey && !!selected && !submitting;

  const handleDeleteTemplate = async (id: string, templateName: string) => {
    if (!window.confirm(`Delete the template "${templateName}"? This can't be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/landing-pages/${id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not delete template');
        return;
      }
      // If the deleted template was selected, fall back to the
      // default starting point so the picker isn't empty-stateful.
      if (selectedId === `page:${id}`) setSelectedId('lead-capture');
      void refetchTemplates();
      toast.success('Template deleted.');
    } catch {
      toast.error('Could not delete template');
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !accountKey || !selected) return;
    setSubmitting(true);
    try {
      // Account templates use the `account:<uuid>` id format so the
      // server can distinguish them from built-in preset ids.
      const templateId = selectedAccountTemplate
        ? `page:${selectedAccountTemplate.id}`
        : selected.id;
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          name: name.trim() || selected.name,
          templateId,
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
            <div className="grid grid-cols-2 gap-3">
              {LP_TEMPLATE_PRESETS.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  preset={tpl}
                  active={selectedId === tpl.id}
                  onSelect={() => setSelectedId(tpl.id)}
                />
              ))}
            </div>
          </div>

          {accountTemplates.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                Your templates
              </label>
              <div className="grid grid-cols-2 gap-3">
                {accountTemplates.map((tpl) => (
                  <AccountTemplateCard
                    key={tpl.id}
                    template={tpl}
                    active={selectedId === `page:${tpl.id}`}
                    onSelect={() => setSelectedId(`page:${tpl.id}`)}
                    onDelete={() => void handleDeleteTemplate(tpl.id, tpl.name)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <Footer
          onClose={onClose}
          handleSubmit={handleSubmit}
          submitting={submitting}
          canSubmit={canSubmit}
          isBlank={selectedId === 'blank' || selectedId === 'blank-html'}
        />
      </div>
    </div>
  );
}

/**
 * Individual template chip in the picker. Renders a scaled-down
 * LandingPagePreviewThumbnail of the preset's built schema, with
 * the icon + name + description below.
 *
 * Each preset's `build()` is called once via useMemo so the
 * preview reuses the same template across re-renders (and so block
 * ids stay stable in the displayed preview).
 */
function TemplateCard({
  preset,
  active,
  onSelect,
}: {
  preset: LandingPageTemplatePreset;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = ICON_MAP[preset.icon];
  const template = React.useMemo<LandingPageContent>(
    () => preset.build(),
    [preset],
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-xl border-2 overflow-hidden transition-all ${
        active
          ? 'border-[var(--primary)] shadow-[0_0_0_1px_var(--primary)]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <div className="relative">
        <LandingPagePreviewThumbnail template={template} height={140} />
        {active && (
          <div className="absolute inset-0 bg-[var(--primary)]/8 pointer-events-none" />
        )}
      </div>
      <div className="flex items-start gap-3 p-3 bg-[var(--card)] border-t border-[var(--border)]">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            active
              ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
              : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{preset.name}</p>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
            {preset.description}
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1 tabular-nums">
            {preset.meta}
          </p>
        </div>
      </div>
    </button>
  );
}

function Footer({
  onClose,
  handleSubmit,
  submitting,
  canSubmit,
  isBlank,
}: {
  onClose: () => void;
  handleSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  isBlank: boolean;
}) {
  return (
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
        {submitting ? 'Creating…' : isBlank ? 'Create + open builder' : 'Create landing page'}
      </button>
    </footer>
  );
}

/**
 * Tile for an account-saved template. Visually parallels the built-in
 * TemplateCard but always uses the ArchiveBoxArrowDownIcon (templates
 * don't carry their own icon choice) and exposes a small delete
 * affordance on hover. Same LandingPagePreviewThumbnail powers the
 * thumbnail render so blocks-mode templates show a real preview and
 * html-mode templates show the static "HTML page" placeholder.
 */
function AccountTemplateCard({
  template,
  active,
  onSelect,
  onDelete,
}: {
  template: AccountTemplate;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`relative group rounded-xl border-2 overflow-hidden transition-all ${
        active
          ? 'border-[var(--primary)] shadow-[0_0_0_1px_var(--primary)]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left"
        aria-pressed={active}
      >
        <div className="relative">
          <LandingPagePreviewThumbnail template={template.schema} height={140} />
          {active && (
            <div className="absolute inset-0 bg-[var(--primary)]/8 pointer-events-none" />
          )}
        </div>
        <div className="flex items-start gap-3 p-3 bg-[var(--card)] border-t border-[var(--border)]">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              active
                ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
            }`}
          >
            <ArchiveBoxArrowDownIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1 pr-6">
            <p className="text-sm font-medium truncate">{template.name}</p>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
              {template.description || 'Account template'}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)] mt-1 tabular-nums">
              Saved {new Date(template.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </button>

      {/* Delete affordance — hidden until hover so the tile reads as
          a selection target first. Click stops propagation so picking
          the tile and deleting it don't fight. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete template ${template.name}`}
        title="Delete template"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--card)]/90 backdrop-blur-sm border border-[var(--border)] text-[var(--muted-foreground)] hover:text-rose-400 hover:border-rose-500/40 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <TrashIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
