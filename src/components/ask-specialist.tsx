'use client';

/**
 * The in-page call to action — "Ask Vera about co-op".
 *
 * The floating bubble is always there, but a bubble is a thing you have to think of.
 * A button next to the guidelines you are already staring at is a thing you notice.
 * Both open the same assistant.
 *
 * Renders nothing on a page with no relevant specialist, so it can be dropped into a
 * shared header without a surrounding conditional at every call site.
 */

import { usePathname } from 'next/navigation';
import { openAiAssist } from '@/lib/ui-events';
import { agentIdentity } from '@/lib/ai/specialists/identity';
import { pageHint } from '@/lib/ai/specialists/page-hints';
import { AgentAvatar } from './agent-avatar';

export function AskSpecialist({
  /** Override the question sent when clicked. Defaults to opening with an empty composer. */
  prompt,
  className = '',
}: {
  prompt?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const hint = pageHint(pathname ?? '');
  if (!hint) return null;

  const identity = agentIdentity(hint.specialist);

  return (
    <button
      type="button"
      onClick={() => openAiAssist({ prompt, send: Boolean(prompt) })}
      className={
        'group inline-flex items-center gap-2 rounded-full border border-[var(--border)] ' +
        'bg-[var(--muted)] py-1 pl-1 pr-3 text-xs text-[var(--muted-foreground)] ' +
        'transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)] ' +
        className
      }
    >
      <AgentAvatar identity={identity} size="sm" />
      <span>
        Ask {identity.name}
        <span className="hidden sm:inline"> about {identity.role.toLowerCase()}</span>
      </span>
    </button>
  );
}
