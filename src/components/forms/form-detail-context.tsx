'use client';

import * as React from 'react';
import type { FormDetail } from '@/lib/services/forms';

/**
 * Lifecycle state for the auto-save indicator that lives in the top
 * toolbar. The builder page pushes updates here; the header renders
 * whichever state is current. Other pages (settings, submissions) read
 * but never write — `idle` is fine for those routes.
 */
export type FormSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface FormDetailContextValue {
  form: FormDetail;
  setForm: React.Dispatch<React.SetStateAction<FormDetail>>;
  saveStatus: FormSaveStatus;
  savedAt: Date | null;
  setSaveState: (status: FormSaveStatus, savedAt?: Date | null) => void;
}

const FormDetailContext = React.createContext<FormDetailContextValue | null>(null);

export function FormDetailProvider({
  initialForm,
  children,
}: {
  initialForm: FormDetail;
  children: React.ReactNode;
}) {
  const [form, setForm] = React.useState<FormDetail>(initialForm);
  const [saveStatus, setSaveStatus] = React.useState<FormSaveStatus>('idle');
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  const setSaveState = React.useCallback(
    (status: FormSaveStatus, when?: Date | null) => {
      setSaveStatus(status);
      if (status === 'saved') {
        setSavedAt(when ?? new Date());
      } else if (when !== undefined) {
        setSavedAt(when);
      }
    },
    [],
  );

  return (
    <FormDetailContext.Provider
      value={{ form, setForm, saveStatus, savedAt, setSaveState }}
    >
      {children}
    </FormDetailContext.Provider>
  );
}

export function useFormDetail(): FormDetailContextValue {
  const ctx = React.useContext(FormDetailContext);
  if (!ctx) throw new Error('useFormDetail must be used inside FormDetailProvider');
  return ctx;
}
