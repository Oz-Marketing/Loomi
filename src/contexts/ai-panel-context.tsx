'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Whether the AI panel is open, and what it should say when it opens.
 *
 * Lifted out of the panel component because the panel is no longer a popout that
 * floats over the page — it's a rail that the main column makes ROOM for. So the
 * shell needs to know it's open (to add right padding) and the sidebar needs to
 * know (to collapse), neither of which can read a sibling's local state.
 *
 * Only the things two components both need live here. Conversation history, the
 * composer, loading state — all still local to the panel, because nothing else has
 * any business reading them.
 */

/** Width of the open panel. Referenced by the shell's slot, so it lives here. */
export const AI_PANEL_WIDTH = '24rem';

interface OpenOptions {
  /** Pre-fill the composer. */
  prompt?: string;
}

interface AiPanelContextValue {
  isOpen: boolean;
  /**
   * Where the panel should RENDER.
   *
   * The shell puts an empty slot beside the page card and registers it here; the
   * panel portals into it. That's what makes the panel a sibling of the card —
   * same top, same height, same rounding — instead of a fixed overlay guessing at
   * the card's geometry with hardcoded offsets. Null on surfaces that have no
   * shell (the builders, docs, media library), where the panel falls back to
   * positioning itself.
   */
  slotEl: HTMLElement | null;
  setSlotEl: (el: HTMLElement | null) => void;
  /**
   * Full-screen mode. The docked rail is for a question you have WHILE working;
   * expanded is for reading a long answer or going back through history, where
   * 24rem stops being enough.
   *
   * Lives here rather than in the panel because the shell must stop reserving the
   * rail's width when the panel is no longer in it.
   */
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  /**
   * A question handed over at open time, consumed once by the panel.
   *
   * Not just "the composer's value": this is specifically the hand-off from a
   * teaser or an in-page CTA, and the panel clears it after reading so re-opening
   * later doesn't resurrect a stale question.
   */
  pendingPrompt: string | null;
  consumePendingPrompt: () => void;
  open: (options?: OpenOptions) => void;
  close: () => void;
  toggle: () => void;
}

const AiPanelContext = createContext<AiPanelContextValue | null>(null);

export function AiPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  const open = useCallback((options?: OpenOptions) => {
    setIsOpen(true);
    if (options?.prompt) setPendingPrompt(options.prompt);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPendingPrompt(null);
    // Closing always returns to the docked size — reopening full-screen because of
    // something you did ten minutes ago is disorienting.
    setExpanded(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) setPendingPrompt(null);
      return !prev;
    });
  }, []);

  const consumePendingPrompt = useCallback(() => setPendingPrompt(null), []);

  const value = useMemo(
    () => ({
      isOpen, pendingPrompt, consumePendingPrompt, open, close, toggle,
      slotEl, setSlotEl, expanded, setExpanded,
    }),
    [isOpen, pendingPrompt, consumePendingPrompt, open, close, toggle, slotEl, expanded],
  );

  return <AiPanelContext.Provider value={value}>{children}</AiPanelContext.Provider>;
}

export function useAiPanel(): AiPanelContextValue {
  const ctx = useContext(AiPanelContext);
  if (!ctx) {
    // Safe fallback for anything rendered outside the provider (isolated tests,
    // the public form routes): the panel simply reads as closed.
    return {
      isOpen: false,
      pendingPrompt: null,
      consumePendingPrompt: () => {},
      open: () => {},
      close: () => {},
      toggle: () => {},
      slotEl: null,
      setSlotEl: () => {},
      expanded: false,
      setExpanded: () => {},
    };
  }
  return ctx;
}
