'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FormEditorShell } from '@/lib/forms/editor/FormEditorShell';
import type { FormTemplate } from '@/lib/forms/types';
import { useFormDetail } from '@/components/forms/form-detail-context';

const AUTOSAVE_MS = 600;
const HISTORY_LIMIT = 50;

export function FormBuilderPage() {
  const { form, setForm, setSaveState } = useFormDetail();
  const [template, setTemplate] = React.useState<FormTemplate>(form.schema);
  const [past, setPast] = React.useState<FormTemplate[]>([]);
  const [future, setFuture] = React.useState<FormTemplate[]>([]);
  const initialRender = React.useRef(true);
  // Tracks the latest template (what the user sees) vs. the last
  // version we've successfully persisted. Used to flush unsaved edits
  // when the builder unmounts — e.g. the Back button — so quick
  // tweaks like a slider drag immediately before navigating aren't
  // lost when the debounce timer is cancelled by React cleanup.
  const latestTemplateRef = React.useRef<FormTemplate>(form.schema);
  const savedTemplateRef = React.useRef<FormTemplate>(form.schema);
  const formIdRef = React.useRef(form.id);

  React.useEffect(() => {
    latestTemplateRef.current = template;
  }, [template]);

  React.useEffect(() => {
    formIdRef.current = form.id;
  }, [form.id]);

  // Defensive mount refetch: pull the canonical form from the server
  // when the builder first mounts. The previous instance of the
  // builder may have just unmount-flushed a keepalive PATCH whose
  // response chain hadn't completed by the time this instance was
  // rendered, leaving useState's initial value (read from context)
  // potentially stale. If the server has fresher data we adopt both
  // the form context AND the local template state so the editor
  // never opens onto pre-edit content.
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/forms/${form.id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.form) return;
        const serverAt = new Date(payload.form.updatedAt).getTime();
        const localAt = new Date(form.updatedAt).getTime();
        if (serverAt <= localAt) return;
        setForm(payload.form);
        setTemplate(payload.form.schema);
        // Reset both refs so we don't immediately re-flush this same
        // schema on the next unmount.
        latestTemplateRef.current = payload.form.schema;
        savedTemplateRef.current = payload.form.schema;
      })
      .catch(() => {
        /* offline / 404 — keep using whatever context provided */
      });
    return () => {
      cancelled = true;
    };
    // Mount-only fetch: deliberately not re-running when form.updatedAt
    // changes (that would feed back into setForm and re-fire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  // Clear the autosave indicator if we leave the builder so the
  // shared header doesn't keep showing a stale "Saved just now".
  React.useEffect(() => {
    return () => setSaveState('idle', null);
  }, [setSaveState]);

  const patchSchema = React.useCallback(
    async (schema: FormTemplate) => {
      setSaveState('saving');
      const res = await fetch(`/api/forms/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveState('error');
        toast.error(payload.error || 'Form autosave failed');
        return;
      }
      savedTemplateRef.current = schema;
      setForm(payload.form);
      setSaveState('saved');
    },
    [form.id, setForm, setSaveState],
  );

  React.useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void patchSchema(template);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(handle);
  }, [template, patchSchema]);

  // Unmount: if we have edits the debounced save never got to flush,
  // fire one final PATCH with `keepalive` so the request survives the
  // page transition. This catches the "drag slider, immediately click
  // Back" scenario that otherwise drops the change.
  //
  // Crucially, we ALSO push the pending schema into the form context
  // optimistically. The layout/provider stay mounted on Back (overview
  // and editor share `[id]/layout.tsx`), so when the user re-enters
  // the builder it reads `form.schema` from the context. Without the
  // optimistic update the keepalive PATCH persists server-side but the
  // remounted builder reads the pre-edit schema from a stale context
  // and visually "loses" the change.
  React.useEffect(() => {
    return () => {
      const pending = latestTemplateRef.current;
      if (pending === savedTemplateRef.current) return;
      // 1) Mark this as the new baseline so a same-tick pagehide
      //    listener doesn't double-send the same payload.
      savedTemplateRef.current = pending;
      // 2) Optimistically reflect the pending schema in the form
      //    context. Safe even after this component unmounts because
      //    the dispatch belongs to the parent provider.
      setForm((prev) => ({ ...prev, schema: pending }));
      // 3) Best-effort server flush via keepalive. We still PROCESS the
      //    response — when it lands, push the server-authoritative
      //    form (with its new updatedAt) into the context so a
      //    subsequent overview/builder re-mount that does its own
      //    refetch can't race-clobber the optimistic schema with an
      //    older snapshot.
      try {
        fetch(`/api/forms/${formIdRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: pending }),
          keepalive: true,
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            if (payload?.form) setForm(payload.form);
          })
          .catch(() => {
            /* keepalive saves are best-effort */
          });
      } catch {
        /* ignore — best-effort flush */
      }
    };
  }, [setForm]);

  // Page-level safety net: if the user closes the tab or hard-navigates
  // while edits are pending, the same keepalive flush runs from the
  // pagehide event. (beforeunload would also work but pagehide fires
  // more reliably on iOS Safari + bfcache.)
  React.useEffect(() => {
    const flush = () => {
      const pending = latestTemplateRef.current;
      if (pending === savedTemplateRef.current) return;
      savedTemplateRef.current = pending;
      try {
        fetch(`/api/forms/${formIdRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: pending }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const handleChange = React.useCallback((next: FormTemplate) => {
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), template]);
    setFuture([]);
    setTemplate(next);
  }, [template]);

  const undo = React.useCallback(() => {
    setPast((items) => {
      const previous = items[items.length - 1];
      if (!previous) return items;
      setFuture((futureItems) => [template, ...futureItems].slice(0, HISTORY_LIMIT));
      setTemplate(previous);
      return items.slice(0, -1);
    });
  }, [template]);

  const redo = React.useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((pastItems) => [...pastItems.slice(-(HISTORY_LIMIT - 1)), template]);
      setTemplate(next);
      return items.slice(1);
    });
  }, [template]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redo, undo]);

  // Inside the email-style layout: the parent layout uses
  // `flex flex-col h-[calc(100vh-2rem)]` with the header at top and
  // this pane filling the rest. No fixed-height wrapper needed here.
  return (
    <div className="flex-1 min-h-0 flex gap-4">
      <FormEditorShell
        template={template}
        onChange={handleChange}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={undo}
        onRedo={redo}
        publicUrl={`/f/${form.slug}`}
        embedSnippet={form.embedSnippet}
      />
    </div>
  );
}
