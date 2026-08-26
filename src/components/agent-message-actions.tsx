'use client';

/**
 * The row of actions under a message.
 *
 * Revealed on hover rather than always shown: at this panel width a permanent
 * toolbar under every turn is more chrome than conversation. They stay in the DOM
 * (opacity, not conditional rendering) so keyboard focus can still reach them —
 * `focus-within` brings the row up for anyone tabbing through.
 */

import { useState } from 'react';
import {
  Square2StackIcon,
  CheckIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  BackwardIcon,
} from '@heroicons/react/24/outline';

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  );
}

export function AgentMessageActions({
  content,
  /** User turns can be edited and re-sent; assistant turns can be re-run. */
  onEdit,
  onRetry,
  /**
   * Make this message the end of the conversation again — everything after it is
   * discarded, from the saved thread as well as the view.
   *
   * Distinct from Edit, which puts the question back in the composer to change.
   * Rewind keeps what's here and drops what came next, so you can take a different
   * direction from a point that was still going well.
   */
  onRewind,
  align = 'left',
}: {
  content: string;
  onEdit?: () => void;
  onRetry?: () => void;
  onRewind?: () => void;
  align?: 'left' | 'right';
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked (insecure origin, denied permission) — the button
      // simply doesn't confirm rather than throwing an error at someone who
      // only wanted to copy a sentence.
    }
  }

  return (
    <div
      className={`flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
        {copied ? (
          <CheckIcon className="h-3 w-3" />
        ) : (
          <Square2StackIcon className="h-3 w-3" />
        )}
      </ActionButton>
      {onEdit && (
        <ActionButton label="Edit and resend" onClick={onEdit}>
          <PencilSquareIcon className="h-3 w-3" />
        </ActionButton>
      )}
      {onRetry && (
        <ActionButton label="Try again" onClick={onRetry}>
          <ArrowPathIcon className="h-3 w-3" />
        </ActionButton>
      )}
      {onRewind && (
        <ActionButton label="Rewind to here" onClick={onRewind}>
          <BackwardIcon className="h-3 w-3" />
        </ActionButton>
      )}
    </div>
  );
}
