export const AI_ASSIST_OPEN_EVENT = 'loomi:ai-assist:open';
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
