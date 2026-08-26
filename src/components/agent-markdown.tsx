'use client';

/**
 * Model output, rendered.
 *
 * Reuses the docs renderer (`lib/docs/markdown`) rather than adding
 * react-markdown, for the reason in that file's header: it escapes every
 * character of the source first and only emits tags it wrote itself, so there is
 * no raw HTML path and no sanitizer to misconfigure. That property matters more
 * here than it does for docs — a doc author is a colleague with a permission,
 * whereas this text is generated from manufacturer PDFs we did not write.
 *
 * The styling is deliberately tighter than an article's: this is a 24rem column,
 * so headings step down gently and lists stay close to the prose around them.
 */

import { useMemo } from 'react';
import { renderMarkdown } from '@/lib/docs/markdown';

export function AgentMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content).html, [content]);
  return (
    <div
      className="agent-md text-xs leading-relaxed text-[var(--foreground)]"
      // Safe by construction: see the module header.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
