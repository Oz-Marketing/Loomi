'use client';

import * as React from 'react';
import useSWR from 'swr';
import { FormRenderer } from '@/lib/forms/render';
import { parseFormTemplate } from '@/lib/forms/types';
import type { FormDetail } from '@/lib/services/forms';
import { usePreloadedForm } from '../render';

export interface EmbeddedFormProps {
  formId?: string;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * EmbeddedForm — renders one of the user's Forms inline using the
 * same FormRenderer the public /f/[slug] page uses. Submissions go
 * to the form's own submission endpoint, NOT the landing page.
 *
 * Two render modes:
 *  - Public LP (server): the renderer wraps us in a PreloadedForms
 *    context with form schemas already fetched server-side. We use
 *    those directly — no client fetch, no auth dependency, works for
 *    anonymous visitors.
 *  - Editor preview (client): no context preload, so we fall back to
 *    SWR-fetching /api/forms/[id]. Live edits to the embedded form
 *    show up in the LP canvas.
 */
export const EmbeddedFormBlock: React.FC<EmbeddedFormProps> = ({
  formId,
  maxWidth = 640,
  align = 'center',
}) => {
  const preloaded = usePreloadedForm(formId);

  // Only fire the SWR fetch when no preloaded schema is available
  // AND we have a formId to fetch. Passing `null` to useSWR disables
  // the request entirely.
  const { data, isLoading } = useSWR<{ form: FormDetail }>(
    !preloaded && formId ? `/api/forms/${formId}` : null,
    fetcher,
  );

  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: `${maxWidth}px`,
    marginLeft: align === 'left' ? 0 : 'auto',
    marginRight: align === 'right' ? 0 : 'auto',
  };

  if (!formId) {
    return (
      <div style={wrapperStyle}>
        <Placeholder hint="Pick a form in the right panel." />
      </div>
    );
  }

  // Server-preloaded path — preferred for the public LP page.
  if (preloaded) {
    return (
      <div style={wrapperStyle}>
        <FormRenderer template={preloaded.schema} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={wrapperStyle}>
        <Placeholder hint="Loading form…" />
      </div>
    );
  }

  if (!data?.form) {
    return (
      <div style={wrapperStyle}>
        <Placeholder hint="Form not found (was it deleted or unpublished?)" />
      </div>
    );
  }

  const template = parseFormTemplate(data.form.schema as unknown);
  if (!template) {
    return (
      <div style={wrapperStyle}>
        <Placeholder hint="This form's schema is malformed." />
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <FormRenderer template={template} />
    </div>
  );
};

function Placeholder({ hint }: { hint: string }) {
  return (
    <div
      style={{
        border: '1px dashed rgba(0,0,0,0.2)',
        background: 'rgba(0,0,0,0.02)',
        borderRadius: 12,
        padding: '48px 24px',
        textAlign: 'center',
        color: 'rgba(0,0,0,0.5)',
        fontSize: 13,
      }}
    >
      Embedded Form — {hint}
    </div>
  );
}

export default EmbeddedFormBlock;
