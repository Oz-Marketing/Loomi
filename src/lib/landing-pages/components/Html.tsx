import * as React from 'react';
import DOMPurify from 'isomorphic-dompurify';

export interface HtmlProps {
  html?: string;
}

/**
 * Sanitize user-supplied HTML before injecting via dangerouslySetInnerHTML.
 *
 * Uses isomorphic-dompurify so the same call works in:
 *  - the editor preview (browser DOMPurify)
 *  - the public /lp/[slug] page (jsdom-backed DOMPurify in the
 *    Node render path)
 *
 * Config:
 *  - FORBID_TAGS strips the obvious injection vectors. DOMPurify's
 *    defaults already block <script>/<style>/<iframe>; we add
 *    <object>/<embed>/<form> for marketing-page hygiene (a Custom
 *    HTML block shouldn't ship a competing form, that's what the
 *    Embedded Form block is for).
 *  - FORBID_ATTR blocks inline event handlers + binding attributes
 *    that DOMPurify allows when configured to keep `style`.
 *  - ALLOWED_URI_REGEXP restricts hrefs/src to safe schemes —
 *    blocks javascript: and data: URLs.
 *
 * The result is a sanitized string; the caller injects it via
 * dangerouslySetInnerHTML. We memoize per `html` so editor preview
 * doesn't re-purify on every render.
 */
const SAFE_URI_REGEX = /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

function sanitize(input: string): string {
  return DOMPurify.sanitize(input, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEX,
  });
}

export const HtmlBlock: React.FC<HtmlProps> = ({ html = '' }) => {
  const safe = React.useMemo(() => sanitize(html), [html]);
  if (!safe.trim()) {
    return (
      <div
        style={{
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
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
};

export default HtmlBlock;
