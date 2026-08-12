import * as React from 'react';
import DOMPurify from 'isomorphic-dompurify';

export interface HtmlProps {
  html?: string;
  marginTop?: number;
  marginBottom?: number;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
}

/**
 * Custom HTML block — mirrors the landing-page block of the same name
 * (src/lib/landing-pages/components/Html.tsx) so markup authored for an
 * LP behaves the same when pasted into a form.
 *
 * Sanitized with isomorphic-dompurify so the identical call runs in the
 * editor canvas (browser DOMPurify) and on the public /f/[slug] page
 * (jsdom-backed DOMPurify in the Node render path).
 *
 * Config notes:
 *  - FORBID_TAGS keeps DOMPurify's defaults (script/style/iframe) and
 *    adds object/embed. `form` matters more here than on an LP: the
 *    public page already wraps every block in a real <form>, and a
 *    nested <form> is invalid HTML that silently breaks submission.
 *  - `input`/`select`/`textarea`/`button` are forbidden for the same
 *    reason — a hand-written input inside the block would post an
 *    unvalidated key the submit pipeline doesn't know about. Real
 *    fields belong in the Fields palette.
 *  - FORBID_ATTR blocks inline event handlers plus `formaction`.
 *  - ALLOWED_URI_REGEXP restricts href/src to safe schemes, so
 *    `javascript:` and `data:` URLs can't slip through.
 */
const SAFE_URI_REGEX = /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'select',
  'textarea',
  'button',
];

const FORBIDDEN_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onfocus',
  'formaction',
];

export function sanitizeBlockHtml(input: string): string {
  if (!input) return '';
  return DOMPurify.sanitize(input, {
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEX,
  });
}

export const HtmlBlock: React.FC<HtmlProps> = ({
  html = '',
  marginTop = 0,
  marginBottom = 16,
  className,
}) => {
  const safe = React.useMemo(() => sanitizeBlockHtml(html), [html]);
  const style: React.CSSProperties = {
    marginTop: `${marginTop}px`,
    marginBottom: `${marginBottom}px`,
    // Long unbroken markup (a pasted tracking pixel URL, a wide table)
    // shouldn't blow out the form card's width.
    maxWidth: '100%',
    overflowX: 'auto',
  };

  if (!safe.trim()) {
    // Editor-only affordance: an empty block would otherwise be a
    // zero-height, unselectable strip on the canvas. The public page
    // never renders this because an empty block is dropped in
    // render.tsx before it reaches the component.
    return (
      <div
        className={className}
        style={{
          ...style,
          border: '1px dashed rgba(0,0,0,0.2)',
          padding: '24px 16px',
          textAlign: 'center',
          color: 'rgba(0,0,0,0.5)',
          fontSize: 13,
          fontFamily: 'monospace',
          borderRadius: 8,
        }}
      >
        Custom HTML — paste markup in the right panel.
      </div>
    );
  }

  return (
    <div className={className} style={style} dangerouslySetInnerHTML={{ __html: safe }} />
  );
};

export default HtmlBlock;
