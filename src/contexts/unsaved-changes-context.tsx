'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

type TrackableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

interface PendingNavigation {
  action: () => void;
  destination: string | null;
}

interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  markDirty: () => void;
  markClean: () => void;
  confirmNavigation: (action: () => void, destination?: string | null) => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

function isTrackableElement(target: EventTarget | null): target is TrackableElement {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
  );
}

function shouldIgnoreElement(element: TrackableElement): boolean {
  if (element.closest('[data-unsaved-ignore="true"]')) return true;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const descriptor = `${element.name || ''} ${element.id || ''} ${element.placeholder || ''}`.toLowerCase();
    if (descriptor.includes('search') || descriptor.includes('filter')) return true;
  }

  if (element instanceof HTMLInputElement) {
    const ignoredTypes = new Set(['hidden', 'submit', 'reset', 'button']);
    if (ignoredTypes.has(element.type)) return true;
    if (element.type === 'search') return true;
  }
  return false;
}

function elementKey(element: TrackableElement): string {
  if (element.isContentEditable) return element.textContent || '';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? '1' : '0';
    }
    if (element.type === 'file') {
      return String(element.files?.length || 0);
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) {
    if (element.multiple) {
      return Array.from(element.selectedOptions).map((option) => option.value).join('|');
    }
    return element.value;
  }
  return element.textContent || '';
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const initialValuesRef = useRef<WeakMap<TrackableElement, string>>(new WeakMap());
  const dirtyElementsRef = useRef<Set<TrackableElement>>(new Set());
  const hasUnsavedChangesRef = useRef(false);
  const bypassGuardRef = useRef(false);
  const restoringHistoryRef = useRef(false);

  const rafIdRef = useRef<number>(0);

  const syncDirtyState = useCallback(() => {
    const dirtyElements = dirtyElementsRef.current;
    for (const element of Array.from(dirtyElements)) {
      if (!document.contains(element)) {
        dirtyElements.delete(element);
      }
    }

    const nextDirty = dirtyElements.size > 0;
    hasUnsavedChangesRef.current = nextDirty;
    // Defer the React state update so it doesn't cause a synchronous flush
    // during input/change event processing. On <select> elements the browser
    // fires `input` before `change`; a synchronous setState here would flush
    // a render that resets the controlled DOM value before React's onChange
    // handler ever runs, making the dropdown appear "stuck".
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => setHasUnsavedChanges(nextDirty));
    return nextDirty;
  }, []);

  const markClean = useCallback(() => {
    initialValuesRef.current = new WeakMap();
    dirtyElementsRef.current.clear();
    hasUnsavedChangesRef.current = false;
    setHasUnsavedChanges(false);
  }, []);

  const markDirty = useCallback(() => {
    hasUnsavedChangesRef.current = true;
    setHasUnsavedChanges(true);
  }, []);

  const captureInitialValue = useCallback((element: TrackableElement) => {
    if (shouldIgnoreElement(element)) return;
    if (initialValuesRef.current.has(element)) return;
    initialValuesRef.current.set(element, elementKey(element));
  }, []);

  const updateElementDirtyState = useCallback((element: TrackableElement) => {
    if (shouldIgnoreElement(element)) return;

    if (!initialValuesRef.current.has(element)) {
      initialValuesRef.current.set(element, elementKey(element));
      return;
    }

    const initialValue = initialValuesRef.current.get(element) || '';
    const currentValue = elementKey(element);
    if (initialValue !== currentValue) {
      dirtyElementsRef.current.add(element);
    } else {
      dirtyElementsRef.current.delete(element);
    }
    syncDirtyState();
  }, [syncDirtyState]);

  const queueNavigation = useCallback((action: () => void, destination?: string | null) => {
    setPendingNavigation({ action, destination: destination || null });
    setShowPrompt(true);
  }, []);

  const confirmNavigation = useCallback((action: () => void, destination?: string | null) => {
    const isDirty = syncDirtyState();
    if (bypassGuardRef.current || !isDirty) {
      action();
      return true;
    }

    queueNavigation(action, destination);
    return false;
  }, [queueNavigation, syncDirtyState]);

  const handleStay = useCallback(() => {
    setShowPrompt(false);
    setPendingNavigation(null);
  }, []);

  const handleLeave = useCallback(() => {
    if (!pendingNavigation) return;
    const action = pendingNavigation.action;

    setShowPrompt(false);
    setPendingNavigation(null);
    markClean();
    bypassGuardRef.current = true;
    action();
    window.setTimeout(() => {
      bypassGuardRef.current = false;
    }, 250);
  }, [markClean, pendingNavigation]);

  useEffect(() => {
    markClean();
    restoringHistoryRef.current = false;
  }, [pathname, markClean]);

  useEffect(() => {
    const handleFocusIn = (event: Event) => {
      if (!isTrackableElement(event.target)) return;
      captureInitialValue(event.target);
    };

    const handleInputChange = (event: Event) => {
      if (!isTrackableElement(event.target)) return;
      updateElementDirtyState(event.target);
    };

    // Use bubble phase (not capture) so React 18's root-level event
    // delegation processes onChange handlers BEFORE we call setState here.
    // Capture-phase setState can cause a synchronous flush that resets
    // controlled component DOM values before React fires its own onChange.
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('input', handleInputChange);
    document.addEventListener('change', handleInputChange);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('input', handleInputChange);
      document.removeEventListener('change', handleInputChange);
    };
  }, [captureInitialValue, updateElementDirtyState]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const isDirty = syncDirtyState();
      if (!isDirty || bypassGuardRef.current) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.dataset.unsavedBypass === 'true') return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(href, currentUrl.href);

      if (nextUrl.href === currentUrl.href) return;
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;

      event.preventDefault();
      event.stopPropagation();
      if (nextUrl.origin !== currentUrl.origin) {
        queueNavigation(
          () => window.location.assign(nextUrl.href),
          nextUrl.host,
        );
        return;
      }

      queueNavigation(
        () => router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`),
        `${nextUrl.pathname}${nextUrl.search}`,
      );
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [queueNavigation, router, syncDirtyState]);

  useEffect(() => {
    const handlePopState = () => {
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false;
        return;
      }
      const isDirty = syncDirtyState();
      if (!isDirty || bypassGuardRef.current) return;

      restoringHistoryRef.current = true;
      window.history.forward();
      queueNavigation(() => {
        bypassGuardRef.current = true;
        window.history.back();
        window.setTimeout(() => {
          bypassGuardRef.current = false;
        }, 250);
      }, 'the previous page');
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [queueNavigation, syncDirtyState]);

  const contextValue = useMemo<UnsavedChangesContextValue>(() => ({
    hasUnsavedChanges,
    markDirty,
    markClean,
    confirmNavigation,
  }), [confirmNavigation, hasUnsavedChanges, markClean, markDirty]);

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}

      {showPrompt && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-overlay-in">
          <div className="glass-modal w-full max-w-md p-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ExclamationTriangleIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Unsaved changes</h3>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  You have unsaved changes{pendingNavigation?.destination ? ` before leaving for ${pendingNavigation.destination}` : ''}.
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1.5">
                  If you leave now, your edits will be lost.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleLeave}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--input)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                Leave without saving
              </button>
              <PrimaryButton
                type="button"
                onClick={handleStay}                
              >
                Stay
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesContextValue {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return context;
}
