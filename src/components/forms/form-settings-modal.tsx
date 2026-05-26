'use client';

import * as React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { FormSettingsForm } from '@/components/forms/form-settings-form';

/**
 * Modal wrapper around the existing FormSettingsForm. Mounted once at
 * the layout level so any page inside /websites/forms/[id]/* can open
 * it by calling `openSettings()` from FormDetailContext.
 *
 * Esc + backdrop click close. Inner scroll for the long form body
 * (basics, submission behavior, embed code, danger zone).
 */
export function FormSettingsModal() {
  const { settingsOpen, closeSettings } = useFormDetail();

  React.useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while the modal is up so the page behind doesn't
    // scroll under the backdrop on long forms.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4"
      onClick={closeSettings}
    >
      <div
        className="glass-modal w-[960px] max-w-full flex flex-col max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Form settings"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Form settings</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Slug, redirects, list attach, embed snippets, and delete.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FormSettingsForm />
        </div>
      </div>
    </div>
  );
}
