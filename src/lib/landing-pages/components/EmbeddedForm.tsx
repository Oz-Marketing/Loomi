'use client';

import * as React from 'react';
import useSWR from 'swr';
import { FormRenderer } from '@/lib/forms/render';
import { FormPublic } from '@/components/forms/form-public';
import { parseFormTemplate } from '@/lib/forms/types';
import type { FormDetail } from '@/lib/services/forms';
import { usePreloadedForm } from '../preloaded-forms-context';
import { useLpAttribution } from '../lp-attribution-context';

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
 * EmbeddedForm — renders one of the user's Forms inline.
 *
 * Two display paths depending on context:
 *  - **Inside an LP** (LpAttributionProvider is mounted): renders
 *    `<FormPublic>` so the form is interactive — submits POST to
 *    /api/f/<slug>/submit, stamps the LP id + slug + UTM cookie
 *    contents onto the resulting FormSubmission row. The preloaded
 *    schema map supplies the form's slug + template so anonymous
 *    visitors don't need to hit the auth'd /api/forms/[id] endpoint.
 *  - **Inside the editor canvas** (no LpAttributionProvider): falls
 *    back to `<FormRenderer>` (static markup, no submit). The editor
 *    doesn't want a submittable form in its preview, and the SWR
 *    fetch path works there since the editor is authenticated.
 *
 * The pick-by-context approach keeps the same component working
 * for both the public LP page (interactive forms with attribution)
 * and the LP editor canvas (visual preview only).
 */
export const EmbeddedFormBlock: React.FC<EmbeddedFormProps> = ({
  formId,
  maxWidth = 640,
  align = 'center',
}) => {
  const preloaded = usePreloadedForm(formId);
  const attribution = useLpAttribution();

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

  // Server-preloaded path — preferred for the public LP page. When
  // we have LP attribution available, render the interactive form
  // (FormPublic). Without attribution we're in editor preview mode
  // so we render the static FormRenderer instead — clicking submit
  // there would just confuse users.
  if (preloaded) {
    return (
      <div style={wrapperStyle}>
        {attribution ? (
          <FormPublic
            slug={preloaded.slug}
            template={preloaded.schema}
            attribution={attribution}
            // `note_`/`meta_` params from the LP URL, resolved for this
            // specific form server-side. Undefined in the editor path
            // below — the canvas has no visitor query string.
            helpTextOverrides={preloaded.noteOverrides}
            metadata={preloaded.metadata}
          />
        ) : (
          <FormRenderer
            template={preloaded.schema}
            options={{ helpTextOverrides: preloaded.noteOverrides }}
          />
        )}
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

  // Editor preview path — no LP attribution, no preloaded slug.
  // Render the static view; the editor canvas doesn't expect users
  // to actually submit from here.
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
