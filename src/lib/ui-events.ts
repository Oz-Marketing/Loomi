export const AI_ASSIST_OPEN_EVENT = 'loomi:ai-assist:open';

/**
 * Payload for {@link AI_ASSIST_OPEN_EVENT}.
 *
 * Optional throughout, because the event predates it: the header's Help action
 * still dispatches a bare `Event` with no detail, and that must keep meaning
 * "just open the panel".
 */
export interface AiAssistOpenDetail {
  /** Pre-fill the composer with this question. */
  prompt?: string;
  /** Send it immediately rather than waiting for the user to press enter. */
  send?: boolean;
}

/**
 * Open the assistant, optionally with a question already in hand.
 *
 * An event rather than an import so any page can offer an in-context CTA without
 * knowing where the bubble is mounted — same reasoning as `openSupportModal`.
 */
export function openAiAssist(detail: AiAssistOpenDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_ASSIST_OPEN_EVENT, { detail }));
}
export const TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT = 'loomi:template-ai-sidebar:toggle';

/**
 * Opens the help desk modal (see components/support-modal). It's mounted once
 * globally in Providers rather than per-surface, so an event is what lets the
 * Studio sidebar, all three top bars, and the client Ad Generator open the same
 * dialog without any of them importing it or knowing where it lives.
 */
export const SUPPORT_MODAL_OPEN_EVENT = 'loomi:support:open';

export function openSupportModal(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SUPPORT_MODAL_OPEN_EVENT));
}

/**
 * Open the co-op guideline reader at a specific document and page.
 *
 * Dispatched when a citation is clicked and the user is ALREADY on the guidelines
 * page — navigating to the same route wouldn't remount anything, so the params
 * alone would be ignored. From elsewhere the citation is a normal navigation with
 * `?doc=&page=`, which is what makes a cited answer shareable.
 */
export const GUIDELINE_READER_OPEN_EVENT = 'loomi:guideline-reader:open';
