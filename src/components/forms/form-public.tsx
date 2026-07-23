'use client';

import * as React from 'react';
import type { FormTemplate } from '@/lib/forms/types';
import { FormRenderer } from '@/lib/forms/render';
import { FormInteractiveContext } from '@/lib/forms/components/FieldFileInput';

interface FormPublicProps {
  slug: string;
  template: FormTemplate;
  /**
   * When true, the page is being rendered inside an iframe via ?embed=1.
   * We post height messages to the parent so the script-tag embed can
   * auto-resize the surrounding iframe.
   */
  embed?: boolean;
  /**
   * Landing-page attribution surfaced when this form is rendered
   * inside a Loomi LP. The submission handler injects the LP id +
   * slug as hidden `__loomi_*` fields so the API stamps them onto
   * the FormSubmission row. UTMs come from the `loomi_lp_utm`
   * cookie that LpTracker sets — they're picked up at submit time.
   */
  attribution?: { pageId: string; pageSlug: string };
  /**
   * Cloudflare Turnstile public site key. When set, the form renders
   * a Turnstile widget that produces a token; the server-side
   * submit pipeline verifies the token before processing. Null = no
   * widget renders (honeypot-only spam defense). The server's
   * `isTurnstileConfigured()` check is the source of truth for
   * whether a token is required — this prop is purely for the
   * client-side render.
   */
  turnstileSiteKey?: string | null;
}

const TURNSTILE_API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Augment window with Cloudflare's runtime — added by the api.js
 *  script once it loads. `turnstile.render` mounts a widget into the
 *  given container and returns a widget id we can use for `reset`. */
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        opts: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset: (widgetIdOrContainer?: string | HTMLElement) => void;
      remove: (widgetIdOrContainer: string | HTMLElement) => void;
    };
  }
}

interface SubmitResponse {
  ok: boolean;
  error?: string;
  errors?: { field: string; message: string }[];
  submissionId?: string;
  redirectUrl?: string | null;
  successMessage?: string | null;
}

type Phase = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Public-facing form. Wraps the rendered template in a real `<form>`
 * with browser-native validation suppressed in favour of server-side
 * checks (so error messages stay consistent regardless of the JS state).
 *
 * Submission flow:
 *   1. Collect FormData from the form element
 *   2. POST it to /api/forms/[slug]/submit (form-data, not JSON)
 *   3. On 200 + redirectUrl: window.location.assign(redirectUrl)
 *   4. On 200 (no redirect): swap to a success message
 *   5. On 400 with field errors: re-render with errors inline
 *   6. On other errors: show a generic error banner
 *
 * When in embed mode we also broadcast our scroll height to the parent
 * window so the iframe loader can match its height to ours.
 */
export function FormPublic({
  slug,
  template,
  embed,
  attribution,
  turnstileSiteKey,
}: FormPublicProps) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [topError, setTopError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const turnstileContainerRef = React.useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = React.useRef<string | null>(null);

  // Mount the Turnstile widget once api.js has loaded. We load the
  // script once per page (guarded by a data attribute) and render in
  // explicit mode so we can reset after a failed submission instead
  // of forcing a page refresh.
  React.useEffect(() => {
    if (!turnstileSiteKey || typeof window === 'undefined') return;

    let cancelled = false;
    const mount = () => {
      if (cancelled) return;
      if (!window.turnstile || !turnstileContainerRef.current) return;
      // Defensive: if a previous mount already rendered into this
      // container (HMR), remove it before re-rendering.
      if (turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          /* widget already gone */
        }
      }
      turnstileWidgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: turnstileSiteKey,
          callback: (token) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(null),
          'error-callback': () => setTurnstileToken(null),
        },
      );
    };

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[data-loomi-turnstile="1"]`,
      );
      if (existing) {
        // Script tag already injected by a sibling form (multi-form
        // landing page). Wait for the global to appear.
        const poll = setInterval(() => {
          if (window.turnstile) {
            clearInterval(poll);
            mount();
          }
        }, 50);
        return () => {
          cancelled = true;
          clearInterval(poll);
        };
      }
      const script = document.createElement('script');
      script.src = TURNSTILE_API_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.loomiTurnstile = '1';
      script.onload = mount;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          /* widget already gone */
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [turnstileSiteKey]);

  // Reset the widget whenever the form returns to an idle state after
  // a failed submission — Turnstile tokens are single-use, so the next
  // submit needs a fresh one.
  React.useEffect(() => {
    if (phase !== 'error') return;
    if (!turnstileWidgetIdRef.current || !window.turnstile) return;
    try {
      window.turnstile.reset(turnstileWidgetIdRef.current);
    } catch {
      /* widget gone */
    }
    setTurnstileToken(null);
  }, [phase]);

  // postMessage height broadcasts — only run in embed mode. Mutation
  // observer + window resize cover the typical reasons the form's
  // intrinsic height changes (lazy images, viewport rotation, errors
  // appearing, success state replacing the form).
  React.useEffect(() => {
    if (!embed || typeof window === 'undefined') return;
    if (window.parent === window) return;

    const post = () => {
      const node = rootRef.current;
      const height = node ? node.scrollHeight : document.body.scrollHeight;
      window.parent.postMessage(
        { type: 'loomi-form-resize', slug, height },
        '*',
      );
    };

    post();
    const observer = new MutationObserver(post);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener('resize', post);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', post);
    };
  }, [embed, slug, phase, successMessage]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === 'submitting') return;

    setPhase('submitting');
    setTopError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);

    // Turnstile token. The widget renders a hidden input named
    // `cf-turnstile-response` that FormData picks up automatically,
    // but we set it explicitly here too in case the user submitted
    // via Enter before the widget's hidden input was injected — the
    // state value is the source of truth after the callback fires.
    if (turnstileSiteKey) {
      if (!turnstileToken) {
        setPhase('error');
        setTopError('Please complete the verification widget before submitting.');
        return;
      }
      formData.set('cf-turnstile-response', turnstileToken);
    }

    // Attach LP attribution (id + slug from React context) and UTMs
    // (from the loomi_lp_utm cookie LpTracker maintains) as hidden
    // `__loomi_*` fields. The submit API plucks these out before
    // validation so they never appear in submission.data.
    if (attribution) {
      formData.set('__loomi_lp_id', attribution.pageId);
      formData.set('__loomi_lp_slug', attribution.pageSlug);
    }
    const utms = readLpUtmCookie();
    if (utms) {
      if (utms.source) formData.set('__loomi_utm_source', utms.source);
      if (utms.medium) formData.set('__loomi_utm_medium', utms.medium);
      if (utms.campaign) formData.set('__loomi_utm_campaign', utms.campaign);
      if (utms.term) formData.set('__loomi_utm_term', utms.term);
      if (utms.content) formData.set('__loomi_utm_content', utms.content);
    }

    let res: Response;
    try {
      res = await fetch(`/api/f/${slug}/submit`, {
        method: 'POST',
        body: formData,
      });
    } catch {
      setPhase('error');
      setTopError('Could not reach the server. Check your connection and try again.');
      return;
    }

    const payload = (await res.json().catch(() => ({}))) as SubmitResponse;

    if (res.ok && payload.ok) {
      if (payload.redirectUrl) {
        // Top-level redirect even when in an iframe — the parent page
        // should ferry users to the thank-you page, not just the iframe.
        if (embed && window.parent !== window) {
          window.parent.postMessage(
            { type: 'loomi-form-redirect', slug, url: payload.redirectUrl },
            '*',
          );
        }
        window.location.assign(payload.redirectUrl);
        return;
      }
      setPhase('success');
      setSuccessMessage(payload.successMessage || 'Thanks! We received your submission.');
      // Notify parent that submission succeeded — host page can fire
      // analytics events from this signal.
      if (embed && window.parent !== window) {
        window.parent.postMessage({ type: 'loomi-form-submitted', slug }, '*');
      }
      // Same signal but as a same-window event so the LP-page
      // tracker (which lives in the same tree, not in a parent
      // iframe) can fire a form_submit analytics event.
      try {
        window.dispatchEvent(
          new CustomEvent('loomi:form-submitted', {
            detail: { slug, submissionId: payload.submissionId },
          }),
        );
      } catch {
        /* CustomEvent unsupported — analytics opt-out */
      }
      return;
    }

    setPhase('error');
    setTopError(payload.error || 'Submission failed. Please try again.');
    if (payload.errors) {
      const map: Record<string, string> = {};
      for (const err of payload.errors) {
        map[err.field] = err.message;
      }
      setFieldErrors(map);
    }
  };

  if (phase === 'success' && successMessage) {
    return (
      <div
        ref={rootRef}
        className="loomi-form-root"
        style={{
          backgroundColor: template.settings.bodyBg,
          color: template.settings.textColor,
          fontFamily: template.settings.fontFamily,
          minHeight: embed ? 'auto' : '100vh',
          padding: '64px 16px',
        }}
      >
        <div
          style={{
            maxWidth: `${template.settings.contentWidth}px`,
            margin: '0 auto',
            backgroundColor: template.settings.contentBg,
            borderRadius: 12,
            padding: '48px 32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 16 }} aria-hidden>
            ✓
          </div>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>
            {successMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Honeypot — visually hidden, expected to remain empty. Real
            users never see it; bots that fill every input get flagged. */}
        <input
          type="text"
          name="_loomi_hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-9999px',
            top: 'auto',
            width: 1,
            height: 1,
            overflow: 'hidden',
          }}
        />

        {/* Enable file-field uploads only on the live public form —
            preview surfaces (editor, overview, thumbnail) stay inert. */}
        <FormInteractiveContext.Provider value={true}>
          <FormRenderer template={template} options={{ errors: fieldErrors }} />
        </FormInteractiveContext.Provider>

        {turnstileSiteKey && (
          <div
            style={{
              maxWidth: `${template.settings.contentWidth}px`,
              margin: '0 auto 16px',
              padding: '0 16px',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            {/* Cloudflare renders the widget into this div after
                api.js loads. Container is empty server-side. */}
            <div ref={turnstileContainerRef} />
          </div>
        )}

        {topError && (
          <div
            role="alert"
            style={{
              maxWidth: `${template.settings.contentWidth}px`,
              margin: '0 auto 16px',
              padding: '12px 16px',
              borderRadius: 8,
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              fontSize: 14,
            }}
          >
            {topError}
          </div>
        )}

        {phase === 'submitting' && (
          <div
            aria-live="polite"
            style={{
              position: 'fixed',
              left: '50%',
              bottom: 16,
              transform: 'translateX(-50%)',
              padding: '8px 14px',
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.8)',
              color: '#fff',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            Submitting…
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * Read the `loomi_lp_utm` cookie LpTracker writes on first visit.
 * Used by LP-embedded forms to attach first-touch UTMs to their
 * submission without round-tripping through React context. Returns
 * null when the cookie is missing or malformed.
 */
interface LpUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

function readLpUtmCookie(): LpUtm | null {
  if (typeof document === 'undefined') return null;
  const target = 'loomi_lp_utm=';
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(target)) continue;
    try {
      const value = decodeURIComponent(trimmed.slice(target.length));
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as LpUtm;
    } catch {
      return null;
    }
  }
  return null;
}
