'use client';

/**
 * Client-only context for preloaded form schemas.
 *
 * The public /lp/[slug] route is a Server Component that imports
 * the LandingPageRenderer. If we call React.createContext at module
 * load time from within render.tsx (which is also imported by
 * client components like the editor canvas), Next.js will pull
 * render.tsx into the server bundle — where the server React build
 * doesn't ship createContext, and the build fails at
 * page-data-collection time with "createContext is not a function".
 *
 * Putting the createContext call behind 'use client' isolates it to
 * the client bundle. The Server Component renders <PreloadedFormsProvider>
 * (also defined here) which is a client boundary; React stitches
 * the server tree to the client provider at hydration time.
 */
import * as React from 'react';
import type { FormTemplate } from '@/lib/forms/types';

export interface PreloadedForm {
  schema: FormTemplate;
}

const PreloadedFormsContext = React.createContext<Map<string, PreloadedForm> | null>(null);

export function usePreloadedForm(formId: string | undefined): PreloadedForm | null {
  const map = React.useContext(PreloadedFormsContext);
  if (!map || !formId) return null;
  return map.get(formId) ?? null;
}

/** Client-boundary wrapper. Server components render this with the
 *  fetched form schemas; the actual Provider lives in the client
 *  bundle so its dependency on React.createContext is satisfied. */
export function PreloadedFormsProvider({
  value,
  children,
}: {
  value: Map<string, PreloadedForm>;
  children: React.ReactNode;
}) {
  return (
    <PreloadedFormsContext.Provider value={value}>
      {children}
    </PreloadedFormsContext.Provider>
  );
}
