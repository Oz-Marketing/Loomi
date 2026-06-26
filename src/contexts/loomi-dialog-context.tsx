'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

type ConfirmDialogOptions = {
  title?: string;
  message: string;
  /** Optional rich content rendered below the message (styled by the caller). */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptDialogOptions = {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  multiline?: boolean;
};

type AlertDialogOptions = {
  title?: string;
  message: string;
  buttonLabel?: string;
};

type ConfirmInput = string | ConfirmDialogOptions;
type PromptInput = string | PromptDialogOptions;
type AlertInput = string | AlertDialogOptions;

type DialogRequest =
  | {
      type: 'confirm';
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      type: 'prompt';
      options: PromptDialogOptions;
      resolve: (value: string | null) => void;
    }
  | {
      type: 'alert';
      options: AlertDialogOptions;
      resolve: () => void;
    };

type LoomiDialogContextValue = {
  confirm: (input: ConfirmInput) => Promise<boolean>;
  prompt: (input: PromptInput) => Promise<string | null>;
  alert: (input: AlertInput) => Promise<void>;
};

const LoomiDialogContext = createContext<LoomiDialogContextValue | null>(null);

function normalizeConfirmInput(input: ConfirmInput): ConfirmDialogOptions {
  if (typeof input === 'string') {
    return { message: input };
  }
  return {
    title: input.title,
    message: input.message,
    body: input.body,
    confirmLabel: input.confirmLabel,
    cancelLabel: input.cancelLabel,
    destructive: input.destructive,
  };
}

function normalizePromptInput(input: PromptInput): PromptDialogOptions {
  if (typeof input === 'string') {
    return { message: input };
  }
  return {
    title: input.title,
    message: input.message,
    defaultValue: input.defaultValue,
    placeholder: input.placeholder,
    confirmLabel: input.confirmLabel,
    cancelLabel: input.cancelLabel,
    required: input.required,
    multiline: input.multiline,
  };
}

function normalizeAlertInput(input: AlertInput): AlertDialogOptions {
  if (typeof input === 'string') {
    return { message: input };
  }
  return {
    title: input.title,
    message: input.message,
    buttonLabel: input.buttonLabel,
  };
}

export function LoomiDialogProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);

  const advanceQueue = useCallback(() => {
    const next = queueRef.current.shift() || null;
    setCurrent(next);
    if (next?.type === 'prompt') {
      setPromptValue(next.options.defaultValue || '');
      setPromptError(null);
    } else {
      setPromptValue('');
      setPromptError(null);
    }
  }, []);

  const enqueue = useCallback((request: DialogRequest) => {
    if (!current) {
      setCurrent(request);
      if (request.type === 'prompt') {
        setPromptValue(request.options.defaultValue || '');
      } else {
        setPromptValue('');
      }
      setPromptError(null);
      return;
    }
    queueRef.current.push(request);
  }, [current]);

  const confirm = useCallback((input: ConfirmInput) => (
    new Promise<boolean>((resolve) => {
      enqueue({
        type: 'confirm',
        options: normalizeConfirmInput(input),
        resolve,
      });
    })
  ), [enqueue]);

  const prompt = useCallback((input: PromptInput) => (
    new Promise<string | null>((resolve) => {
      enqueue({
        type: 'prompt',
        options: normalizePromptInput(input),
        resolve,
      });
    })
  ), [enqueue]);

  const alert = useCallback((input: AlertInput) => (
    new Promise<void>((resolve) => {
      enqueue({
        type: 'alert',
        options: normalizeAlertInput(input),
        resolve,
      });
    })
  ), [enqueue]);

  const closeAsCancel = useCallback(() => {
    if (!current) return;
    if (current.type === 'confirm') {
      current.resolve(false);
    } else if (current.type === 'prompt') {
      current.resolve(null);
    } else {
      current.resolve();
    }
    advanceQueue();
  }, [advanceQueue, current]);

  const closeAsConfirm = useCallback(() => {
    if (!current) return;
    if (current.type === 'confirm') {
      current.resolve(true);
      advanceQueue();
      return;
    }
    if (current.type === 'alert') {
      current.resolve();
      advanceQueue();
      return;
    }
    const required = current.options.required ?? false;
    const nextValue = promptValue;
    if (required && !nextValue.trim()) {
      setPromptError('A value is required.');
      return;
    }
    current.resolve(nextValue);
    advanceQueue();
  }, [advanceQueue, current, promptValue]);

  const contextValue = useMemo<LoomiDialogContextValue>(() => ({
    confirm,
    prompt,
    alert,
  }), [alert, confirm, prompt]);

  const title = current?.type === 'confirm'
    ? (current.options.title || 'Confirm Action')
    : current?.type === 'prompt'
      ? (current.options.title || 'Enter Value')
      : current?.type === 'alert'
        ? (current.options.title || 'Notice')
        : '';

  const message = current?.type === 'confirm'
    ? current.options.message
    : current?.type === 'prompt'
      ? (current.options.message || '')
      : current?.type === 'alert'
        ? current.options.message
        : '';

  const confirmLabel = current?.type === 'confirm'
    ? (current.options.confirmLabel || 'Confirm')
    : current?.type === 'prompt'
      ? (current.options.confirmLabel || 'Save')
      : current?.type === 'alert'
        ? (current.options.buttonLabel || 'OK')
        : 'Confirm';

  const cancelLabel = current?.type === 'confirm'
    ? (current.options.cancelLabel || 'Cancel')
    : current?.type === 'prompt'
      ? (current.options.cancelLabel || 'Cancel')
      : 'Cancel';

  const confirmButtonClass = current?.type === 'confirm' && current.options.destructive
    ? 'bg-red-500 hover:bg-red-600'
    : 'bg-[var(--primary)] hover:opacity-90';

  return (
    <LoomiDialogContext.Provider value={contextValue}>
      {children}
      {current && (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={closeAsCancel}
        >
          <div
            className="glass-modal w-[420px] max-w-[calc(100vw-2rem)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">{title}</h3>
              {current.type !== 'alert' && (
                <button
                  onClick={closeAsCancel}
                  className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  aria-label="Close dialog"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="p-5 space-y-3">
              {message && (
                <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap">
                  {message}
                </p>
              )}

              {current.type === 'confirm' && current.options.body}

              {current.type === 'prompt' && (
                <div>
                  {current.options.multiline ? (
                    <textarea
                      value={promptValue}
                      onChange={(event) => {
                        setPromptValue(event.target.value);
                        if (promptError) setPromptError(null);
                      }}
                      placeholder={current.options.placeholder || ''}
                      className="w-full min-h-[100px] px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                      autoFocus
                    />
                  ) : (
                    <input
                      type="text"
                      value={promptValue}
                      onChange={(event) => {
                        setPromptValue(event.target.value);
                        if (promptError) setPromptError(null);
                      }}
                      placeholder={current.options.placeholder || ''}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          closeAsConfirm();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          closeAsCancel();
                        }
                      }}
                    />
                  )}
                  {promptError && (
                    <p className="text-xs text-red-400 mt-2">{promptError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              {current.type !== 'alert' && (
                <button
                  onClick={closeAsCancel}
                  className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  {cancelLabel}
                </button>
              )}
              <button
                onClick={closeAsConfirm}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${confirmButtonClass}`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </LoomiDialogContext.Provider>
  );
}

export function useLoomiDialog(): LoomiDialogContextValue {
  const context = useContext(LoomiDialogContext);
  if (!context) {
    throw new Error('useLoomiDialog must be used within a LoomiDialogProvider');
  }
  return context;
}
