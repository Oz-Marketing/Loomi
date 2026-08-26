'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import {
  AI_ASSIST_OPEN_EVENT,
  TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT,
  GUIDELINE_READER_OPEN_EVENT,
  type AiAssistOpenDetail,
} from '@/lib/ui-events';
import { pageHint } from '@/lib/ai/specialists/page-hints';
import { agentIdentity, isSystemAgent, SYSTEM_AGENT } from '@/lib/ai/specialists/identity';
import { useAiPanel, AI_PANEL_WIDTH } from '@/contexts/ai-panel-context';
import { RainbowSparklesIcon } from './icons/rainbow-sparkles';
import { AgentAvatar } from './agent-avatar';
import { AgentMessageActions } from './agent-message-actions';
import { AgentMarkdown } from './agent-markdown';
import { AgentConversations } from './agent-conversations';
import { useDictation } from '@/hooks/use-dictation';
import { AgentTeaser } from './agent-teaser';
import {
  SparklesIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
  ClockIcon,
  CheckIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  PencilSquareIcon,
  MicrophoneIcon,
  PaperClipIcon,
  StopIcon,
} from '@heroicons/react/24/outline';

/** A citation a specialist's tools produced — see lib/ai/specialists/coop-tools. */
export interface MessageCitation {
  docId: string;
  make?: string;
  title: string;
  page: number;
  snippet?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  citations?: MessageCitation[];
  /** Set when the answer was cut short — rendered as a warning, not hidden. */
  truncatedReason?: string | null;
  /** Saved row id, once the turn has been persisted. Absent while in flight. */
  id?: string;
  /**
   * ISO time the turn was sent. Set locally when you send, and restored from the
   * saved thread when one is reopened — so a conversation you come back to a week
   * later still says when you asked, not when you reopened it.
   */
  at?: string;
}

const PRESETS = [
  'How do I create an email?',
  'What template types exist?',
  'How do I connect an integration?',
];

export function AiBubble() {
  const pathname = usePathname();
  const router = useRouter();
  const { accountKey, accountData, userRole, userName, isAdmin } = useAccount();

  // Open state is SHARED: the shell reads it to reserve the rail's width and to
  // fold the nav. See ai-panel-context.
  const {
    isOpen, open, close, toggle, pendingPrompt, consumePendingPrompt, slotEl,
    expanded, setExpanded,
  } = useAiPanel();
  const setIsOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(isOpen) : next;
      if (value) open();
      else close();
    },
    [isOpen, open, close],
  );
  const [isTemplateAiSidebarOpen, setIsTemplateAiSidebarOpen] = useState(false);

  // The saved thread this exchange belongs to. Null until the first message —
  // opening the panel and closing it again should leave nothing behind.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);
  /** What the agent is doing right now, oldest first. Cleared when a turn ends. */
  const [trail, setTrail] = useState<string[]>([]);
  /** Live request, so Stop can actually abort it rather than just hiding it. */
  const abortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  // Which specialist, if any, owns this page — drives the teaser beside the bubble.
  // Null on most pages, deliberately: a nudge that appears everywhere gets ignored.
  const hint = pageHint(pathname ?? '');

  // Who the panel is FOR. Loomi AI unless a specialist owns this page — the
  // generalist keeps the sparkle, a specialist takes the slot with its own face.
  const identity = hint ? agentIdentity(hint.specialist) : SYSTEM_AGENT;
  const isSystem = isSystemAgent(identity);
  // A specialist's page suggests its own questions; otherwise the platform ones.
  const presets = hint ? hint.examples.slice(0, 3) : PRESETS;

  // ── Visibility: hide on template editor, login, preview ──
  const isTemplateEditor =
    pathname === '/templates/editor' ||
    /^\/templates\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/templates\/folder\/[^/]+$/.test(pathname) ||
    /^\/components\/[^/]+$/.test(pathname) ||
    /^\/components\/folder\/[^/]+$/.test(pathname);
  // The flow builder ships its own embedded AI (Loomi AI panel on the
  // left rail) — hide the global bubble so we don't end up with two
  // entry points stacked on the canvas.
  const isFlowBuilder =
    /^\/flows\/[^/]+$/.test(pathname) ||
    /^\/subaccount\/[^/]+\/flows\/[^/]+$/.test(pathname);
  const isFullScreen =
    pathname.startsWith('/preview') ||
    pathname.startsWith('/login') ||
    // The other unauthenticated auth pages — same reasoning as /login: there's
    // no session for Loomi AI to act on, so the FAB is dead weight.
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/onboarding') ||
    // Public hosted forms — no app chrome, no AI affordance.
    pathname.startsWith('/f/');

  // ── Keyboard shortcut: Cmd/Ctrl+J ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        if (isTemplateEditor) {
          window.dispatchEvent(
            new CustomEvent(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, { detail: { open: true } }),
          );
        } else {
          toggle();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isTemplateEditor, toggle]);

  // ── Open from header Help action ──
  useEffect(() => {
    // The header's Help action still dispatches a bare Event with no detail, so
    // everything here has to degrade to "just open the panel".
    const handleOpen = (evt: Event) => {
      const detail = (evt as CustomEvent<AiAssistOpenDetail>).detail;
      open({ prompt: detail?.prompt });
    };

    window.addEventListener(AI_ASSIST_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(AI_ASSIST_OPEN_EVENT, handleOpen);
  }, [open]);

  // A question handed over by a teaser or an in-page CTA, taken exactly once so
  // re-opening the panel later doesn't resurrect it.
  useEffect(() => {
    if (!pendingPrompt) return;
    setPrompt(pendingPrompt);
    consumePendingPrompt();
  }, [pendingPrompt, consumePendingPrompt]);

  useEffect(() => {
    const syncFromBody = () => {
      if (typeof document === 'undefined') return;
      setIsTemplateAiSidebarOpen(document.body.dataset.templateAiSidebar === 'open');
    };

    const handleSidebarToggle = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{ open?: boolean }>;
      if (typeof customEvent.detail?.open === 'boolean') {
        setIsTemplateAiSidebarOpen(customEvent.detail.open);
        return;
      }
      syncFromBody();
    };

    syncFromBody();
    window.addEventListener(
      TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT,
      handleSidebarToggle as EventListener,
    );
    return () => {
      window.removeEventListener(
        TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT,
        handleSidebarToggle as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (isTemplateAiSidebarOpen) {
      setIsOpen(false);
    }
  }, [isTemplateAiSidebarOpen]);

  // ── Auto-focus input when panel opens ──
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // NO click-outside-to-close. The panel is docked beside the content rather than
  // floating over it, so clicking the page is ordinary work — reading the very
  // thing you're asking about — not a gesture meaning "dismiss this". Closing is
  // the X, ⌘J, or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Only when focus is inside the panel: Escape elsewhere belongs to whatever
      // the user is actually working in.
      if (e.key !== 'Escape') return;
      if (panelRef.current?.contains(document.activeElement)) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  /**
   * Halt the in-flight answer.
   *
   * A real abort, not a UI trick: the request is cancelled, so the server stops
   * streaming and stops spending tokens on a turn nobody is waiting for any more.
   * Whatever the model already said stays on screen — it's usually the reason the
   * user hit stop.
   */
  const stopResponding = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setTrail([]);
  }, []);

  // ── Voice ──
  // Appends rather than replaces: people dictate a sentence, look at it, then
  // dictate the next one.
  const { supported: speechSupported, listening: dictating, toggle: toggleDictation } =
    useDictation(
      useCallback((text: string) => {
        setPrompt((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
      }, []),
    );

  // ── Attach ──
  // TEXT ONLY for now, inlined into the composer. The agent runtime takes string
  // turns, so a PDF or an image would need document/image content blocks plumbed
  // through it AND somewhere to store the file — neither of which should be
  // guessed at behind a paperclip. Inlining a .txt/.md/.csv is genuinely useful
  // today and doesn't pretend to more than it does.
  const attachFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.csv,.json,.log,text/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 200_000) {
        setError('That file is too large to attach — 200 KB max for now.');
        return;
      }
      try {
        const text = await file.text();
        setPrompt((prev) =>
          `${prev ? `${prev.trimEnd()}\n\n` : ''}--- ${file.name} ---\n${text}`.trim(),
        );
        inputRef.current?.focus();
      } catch {
        setError('Could not read that file.');
      }
    };
    input.click();
  }, []);

  // Open a citation where it can actually be read: the guideline reader on the
  // co-op settings page, at the cited document and page. Query params rather than
  // an event so the link survives a full navigation from anywhere in the app.
  const openCitation = useCallback(
    (c: MessageCitation) => {
      const target = `/settings/coop-guidelines?doc=${encodeURIComponent(c.docId)}&page=${c.page}`;
      if (pathname !== '/settings/coop-guidelines') router.push(target);
      else window.dispatchEvent(new CustomEvent(GUIDELINE_READER_OPEN_EVENT, { detail: c }));
    },
    [pathname, router],
  );

  /**
   * Rewind: this message becomes the end of the conversation again.
   *
   * Truncates the SAVED thread too. Without that the rewind would only change
   * what you're looking at — reopening the thread later would resurrect the turns
   * you just discarded, and a conversation that disagrees with itself depending on
   * when you read it is worse than one that was never saved.
   */
  const rewindTo = useCallback(
    async (index: number) => {
      const anchorMsg = history[index];
      setHistory((prev) => prev.slice(0, index + 1));
      setError('');
      // Focus the composer: after a rewind the next thing you do is type.
      setTimeout(() => inputRef.current?.focus(), 0);

      if (!conversationId || !anchorMsg?.id) return;
      try {
        await fetch(`/api/agents/${identity.key}/conversations/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ truncateAfterMessageId: anchorMsg.id }),
        });
      } catch {
        // The view is already rewound; the saved copy will simply be longer.
      }
    },
    [history, conversationId, identity.key],
  );

  /** Start a fresh thread. The saved one stays in history untouched. */
  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setConversationTitle('');
    setHistory([]);
    setError('');
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  /** Reopen a saved thread, citations and all. */
  const openConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${identity.key}/conversations/${id}`);
      if (!res.ok) return;
      const { conversation } = await res.json();
      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setHistory(
        (conversation.messages as Array<{
          role: 'user' | 'assistant';
          content: string;
          id?: string;
          citations?: MessageCitation[] | null;
          truncatedReason?: string | null;
          createdAt?: string;
        }>).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ?? undefined,
          truncatedReason: m.truncatedReason ?? null,
          at: m.createdAt,
        })),
      );
      setShowHistory(false);
    } catch {
      // Leave the current thread alone rather than half-loading another.
    }
  }, [identity.key]);

  // ── Send message ──
  //
  // Two endpoints, chosen by whether a SPECIALIST owns this page. They are not the
  // same shape: the specialist route runs a tool loop and answers with citations,
  // the generalist route answers from the knowledge base. Routing here rather than
  // behind one endpoint keeps the specialist's permission check at its own door.
  const sendMessage = useCallback(
    async (override?: string) => {
      const trimmed = (override ?? prompt).trim();
      if (!trimmed || loading) return;

      if (!override) setPrompt('');
      setError('');
      setLoading(true);

      const userMsg: ChatMessage = {
        role: 'user',
        content: trimmed,
        at: new Date().toISOString(),
      };
      setHistory((prev) => [...prev, userMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const priorTurns = history.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // A conversation row is created on the FIRST message, not when the panel
        // opens — otherwise every idle open would leave an empty thread in the
        // user's history to tidy up.
        let convoId = conversationId;
        if (!convoId) {
          try {
            const res = await fetch(`/api/agents/${identity.key}/conversations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ firstPrompt: trimmed, accountKey }),
            });
            if (res.ok) {
              const created = await res.json();
              convoId = created.id;
              setConversationId(created.id);
              setConversationTitle(created.title);
            }
          } catch {
            // Unsaved is a worse outcome than no answer, but only slightly —
            // carry on and let the turn happen.
          }
        }

        // The specialist route STREAMS: progress events while it works, then a
        // final `done`. The generalist route is a plain JSON reply.
        if (hint) {
          setTrail([]);
          const res = await fetch(`/api/agents/${identity.key}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              messages: [...priorTurns, { role: 'user', content: trimmed }],
              conversationId: convoId,
              context: { page: pathname, accountKey, accountName: accountData?.dealer || null },
            }),
          });
          if (!res.ok || !res.body) {
            setError('Request failed');
            setLoading(false);
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffered = '';
          let done: Record<string, unknown> | null = null;

          // NDJSON: split on newlines and keep the trailing partial line for the
          // next chunk — a JSON object can straddle a network read.
          for (;;) {
            const { value, done: finished } = await reader.read();
            if (finished) break;
            buffered += decoder.decode(value, { stream: true });
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              let evt: Record<string, unknown>;
              try {
                evt = JSON.parse(line);
              } catch {
                continue;
              }
              if (evt.type === 'tool' && typeof evt.label === 'string') {
                const label = evt.label;
                setTrail((prev) => [...prev, label]);
              } else if (evt.type === 'error') {
                setError(typeof evt.error === 'string' ? evt.error : 'Request failed');
                setLoading(false);
                setTrail([]);
                return;
              } else if (evt.type === 'suggestions' && Array.isArray(evt.items)) {
                // Arrives after `done`, so the answer is already rendered — attach
                // the chips to the last assistant turn rather than a new one.
                const items = evt.items.filter((i): i is string => typeof i === 'string');
                setHistory((prev) => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === 'assistant') {
                      next[i] = { ...next[i], suggestions: items };
                      break;
                    }
                  }
                  return next;
                });
              } else if (evt.type === 'done') {
                done = evt;
                // Render the answer THE MOMENT it arrives, not when the stream
                // closes: `suggestions` is sent after `done`, so waiting would
                // leave the chips looking for an assistant turn that isn't there
                // yet — and would hold a finished answer back for a round trip
                // that adds nothing to it.
                setTrail([]);
                setLoading(false);
                setHistory((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    content: typeof evt.reply === 'string' ? evt.reply : '',
                    citations: Array.isArray(evt.emitted)
                      ? (evt.emitted as MessageCitation[])
                      : undefined,
                    truncatedReason: (evt.truncationReason as string | null) ?? null,
                  },
                ]);
                setTimeout(() => {
                  scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                    behavior: 'smooth',
                  });
                }, 50);
              }
            }
          }

          setTrail([]);
          setLoading(false);
          // The stream ended without a `done` — a dropped connection or a crash
          // upstream. Say so rather than leaving a question with no answer under it.
          if (!done) setError('The answer was cut off before it arrived.');
          return;
        }

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            prompt: trimmed,
            history: priorTurns,
            context: {
              page: pathname,
              accountKey,
              accountName: accountData?.dealer || null,
              userRole,
              userName,
              isAdmin,
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Request failed');
          setLoading(false);
          return;
        }

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.reply || '',
          suggestions: data.suggestions || [],
          citations: Array.isArray(data.emitted) ? (data.emitted as MessageCitation[]) : undefined,
          truncatedReason: data.truncationReason ?? null,
        };
        setHistory((prev) => [...prev, assistantMsg]);

        // Auto-scroll
        setTimeout(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }, 50);
      } catch (err: unknown) {
        // Stopping is something the user chose; it is not a failure to report.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Request failed';
        setError(message);
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [
      prompt,
      loading,
      history,
      pathname,
      accountKey,
      accountData,
      userRole,
      userName,
      isAdmin,
      hint,
      identity.key,
      conversationId,
    ],
  );

  // Don't render on hidden pages or when template sidebar is open
  if (isFullScreen) return null;
  if (isFlowBuilder) return null;
  if (isTemplateEditor && isTemplateAiSidebarOpen) return null;

  // On template editor pages, show only the bubble that opens the sidebar
  if (isTemplateEditor) {
    return (
      <button
        ref={bubbleRef}
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, { detail: { open: true } }),
          );
        }}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full text-zinc-900 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ai-horizon-fab"
        title="Ask Loomi AI (⌘J)"
      >
        <SparklesIcon className="w-5 h-5" />
      </button>
    );
  }

  // Hide bubble when template AI sidebar is open on non-editor pages
  if (isTemplateAiSidebarOpen) return null;

  // When the shell offers a slot, the panel renders THERE — as a sibling of the
  // page card — rather than as an overlay. `panel` is built either way; only its
  // destination changes.
  // WHERE the panel renders, which is three different answers:
  //
  //  expanded  → a portal to <body>. It is a modal over the whole app, and it must
  //              escape the shell completely: `position: fixed` is contained by any
  //              ancestor with a transform, filter or backdrop-filter, and the page
  //              card is explicitly built with a backdrop-blur layer (see the note
  //              in SurfaceShell). Rendering in the tree and hoping is how a "modal"
  //              ends up boxed inside the content area.
  //  docked    → the shell's slot, as a sibling of the page card.
  //  no shell  → in place, floating in the gutter.
  const renderPanel = (panel: React.ReactNode) => {
    if (expanded) {
      if (typeof document === 'undefined') return null;
      return createPortal(
        <>
          {/* Scrim. Clicking it collapses back to the docked panel rather than
              closing outright — the conversation is usually why you expanded. */}
          <div
            className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm motion-safe:animate-[ai-scrim-in_180ms_ease-out]"
            onClick={() => setExpanded(false)}
            aria-hidden
          />
          {panel}
        </>,
        document.body,
      );
    }
    return slotEl ? createPortal(panel, slotEl) : panel;
  };

  return (
    <>
      {/* ── Chat Panel ── */}
      {isOpen && renderPanel(
        <div
          ref={panelRef}
          role="complementary"
          aria-label={`${identity.name} assistant`}
          style={slotEl || expanded ? undefined : { width: AI_PANEL_WIDTH }}
          className={
            // `ai-assist-panel` is the established Loomi AI surface — the rainbow
            // ring, the saturated blur, the brand shadow. Same treatment in all
            // three shapes below; only the geometry changes.
            // NOTE: no `relative` here. Two position utilities in one class string
            // is decided by stylesheet order, not attribute order — `.relative`
            // wins over `.fixed` in Tailwind's output, which turned the expanded
            // modal into a relatively-positioned block nudged 40px off its flow
            // position. Each branch below states its own `position`; the ring's
            // absolute ::before is happy with either.
            'ai-assist-panel ai-assist-panel--docked flex overflow-hidden rounded-2xl ' +
            'motion-safe:animate-[ai-panel-in_220ms_ease-out] ' +
            (expanded
              ? // Full-screen: a large card inset from the viewport rather than a
                // true edge-to-edge takeover, so it still reads as Loomi chrome
                // sitting on the app instead of a different application.
                'fixed inset-3 md:inset-6 lg:inset-10 z-[200] flex-row'
              : slotEl
                ? // Inside the shell's slot: fill it exactly, so top, height and
                  // rounding all match the page card without measuring anything.
                  'relative h-full w-full flex-col'
                : // No shell on this surface (builders, docs, media library) —
                  // float in the same gutter the shell would have used.
                  'fixed right-3 top-3 bottom-3 z-50 flex-col max-w-[calc(100vw-1.5rem)] max-md:w-[calc(100vw-1.5rem)]')
          }
        >
          {/* Full-screen gets the conversation list as a permanent left column —
              the thing the docked width can't afford. */}
          {expanded && (
            <AgentConversations
              variant="inline"
              agentKey={identity.key}
              activeId={conversationId}
              onOpen={(id) => void openConversation(id)}
              onNew={startNewConversation}
              onClose={() => setShowHistory(false)}
              onActiveDeleted={startNewConversation}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          {/* No surface of its own: the title and the composer sit directly on the
              panel's ground. Only the conversations card floats. */}
          <div className="px-4 py-3 flex items-center justify-between">
            {/* The generalist keeps the sparkle it has always had; a specialist
                takes the slot with its own face and name. That swap IS the signal
                that you're now talking to somebody in particular. */}
            <div className="flex items-center gap-2 min-w-0">
              {isSystem ? (
                <div className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center flex-shrink-0">
                  <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
                </div>
              ) : (
                <AgentAvatar identity={identity} size="sm" active={loading} />
              )}
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--foreground)] truncate">
                  {identity.name}
                </span>
                {!isSystem && (
                  <span className="block text-[10px] text-[var(--muted-foreground)] truncate">
                    {identity.role}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded flex-shrink-0">
                ⌘J
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* "Clear" used to throw the conversation away. Now threads are
                  saved, so the same button becomes "start another" — nothing is
                  destroyed, and the old thread is one tap away in History.
                  Hidden when expanded: the conversations card beside it already
                  carries a "+ New", and two buttons for one action is noise. */}
              {!expanded && (
                <button
                  onClick={startNewConversation}
                  title="New conversation"
                  aria-label="New conversation"
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Redundant when the list is already a column beside us. */}
              {!expanded && (
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  title="Conversation history"
                  aria-label="Conversation history"
                  className={`p-1.5 rounded-lg transition-colors hover:bg-[var(--muted)] ${
                    showHistory
                      ? 'text-[var(--foreground)] bg-[var(--muted)]'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <ClockIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  setExpanded(!expanded);
                  // The overlay list has no purpose once there's a real column.
                  if (!expanded) setShowHistory(false);
                }}
                title={expanded ? 'Collapse' : 'Expand'}
                aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                {expanded ? (
                  <ArrowsPointingInIcon className="w-3.5 h-3.5" />
                ) : (
                  <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Close"
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* No context bar. The account and the current route are still SENT with
              every message (see sendMessage) — they just aren't printed back at the
              user, who can already see which page they're on and which account
              they're in from the app around the panel. */}

          {/* Message thread */}
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto p-3 min-h-[200px] ai-assist-thread"
          >
            {/* Saved threads. Overlays the conversation — see the component header
                for why it isn't a sidebar at this width. */}
            {showHistory && (
              <AgentConversations
                agentKey={identity.key}
                activeId={conversationId}
                onOpen={(id) => void openConversation(id)}
                onNew={startNewConversation}
                onClose={() => setShowHistory(false)}
                onActiveDeleted={startNewConversation}
              />
            )}

            {/* Reading measure. The scroller above stays full width — its
                background is the panel's surface and its scrollbar belongs on
                the edge — while the conversation itself is capped, because a
                950px line of body copy in the expanded modal is a chore to
                read. Docked, the panel is narrower than the cap, so this does
                nothing there. */}
            <div className="mx-auto w-full max-w-2xl space-y-3">
            {/* Empty state */}
            {history.length === 0 && !loading && (
              <div className="text-center py-6 space-y-3">
                {isSystem ? (
                  // The rainbow sparkle IS the Loomi AI signature — no tile needed
                  // around it (see icons/rainbow-sparkles).
                  <RainbowSparklesIcon className="w-9 h-9 mx-auto" />
                ) : (
                  <div className="flex justify-center">
                    <AgentAvatar identity={identity} size="lg" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)] mb-1">
                    {isSystem ? 'Loomi AI' : identity.name}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] px-4">
                    {identity.greeting}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setPrompt(preset)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {history.map((msg, idx) => (
              <div key={`chat-${idx}`} className="group">
                {msg.role === 'user' ? (
                  <div className="space-y-1">
                    <div className="flex justify-end">
                      {/* Neutral primary-tinted bubble for user messages.
                          Earlier this was a pink gradient with white text;
                          the brand surface is now the panel outline, not
                          each message. */}
                      <div className="max-w-[85%] bg-[var(--primary)] text-white rounded-xl rounded-br-sm px-3 py-2">
                        <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      {msg.at && (
                        <time
                          dateTime={msg.at}
                          title={new Date(msg.at).toLocaleString()}
                          className="text-[9px] text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {new Date(msg.at).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                      )}
                    <AgentMessageActions
                      content={msg.content}
                      align="right"
                      onEdit={() => {
                        // Put the question back in the composer and drop this turn
                        // and everything after it — the same "rewind and rephrase"
                        // every chat app does, rather than appending a correction
                        // the model has to reconcile against its own last answer.
                        setPrompt(msg.content);
                        setHistory((prev) => prev.slice(0, idx));
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      onRewind={idx < history.length - 1 ? () => void rewindTo(idx) : undefined}
                    />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* No bubble. The assistant's answer is the body copy of this
                        panel — the longest thing in it — and boxing it made the
                        panel read as two competing surfaces. */}
                    <div className="px-1">
                      <AgentMarkdown content={msg.content} />
                    </div>
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="flex flex-col gap-1 px-1">
                        {msg.citations.map((c, cIdx) => (
                          <button
                            key={`cite-${idx}-${cIdx}`}
                            type="button"
                            onClick={() => openCitation(c)}
                            className="flex items-start gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-left text-[10px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)]"
                          >
                            <DocumentTextIcon className="mt-px h-3 w-3 flex-shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {c.title} · p.{c.page}
                              </span>
                              {c.snippet && (
                                <span className="block truncate opacity-70">{c.snippet}</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {msg.truncatedReason && (
                      <p className="px-1 text-[10px] text-[var(--destructive)]">
                        {msg.truncatedReason === 'max_tokens'
                          ? 'This answer was cut short — ask for the rest, or narrow the question.'
                          : 'Stopped before finishing every lookup — the answer may be incomplete.'}
                      </p>
                    )}
                    <AgentMessageActions
                      content={msg.content}
                      onRetry={() => {
                        // Re-ask the question that produced this answer.
                        const prior = history[idx - 1];
                        if (!prior || prior.role !== 'user') return;
                        setHistory((prev) => prev.slice(0, idx - 1));
                        void sendMessage(prior.content);
                      }}
                      onRewind={idx < history.length - 1 ? () => void rewindTo(idx) : undefined}
                    />
                    {/* Suggestion chips */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 ml-1">
                        {msg.suggestions.map((s, sIdx) => (
                          <button
                            key={`sug-${idx}-${sIdx}`}
                            onClick={() => setPrompt(s)}
                            className="px-2 py-1 rounded-lg text-[10px] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Progress trail.
                Not a spinner. A twenty-second "Thinking..." is indistinguishable
                from a hang and says nothing about whether the answer will be any
                good; the steps below are the agent's REAL tool calls, so they
                double as a preview of the reasoning and as the first clue when an
                answer turns out wrong. Completed steps dim, the newest is live. */}
            {loading && (
              <div className="space-y-1 px-1 py-1">
                {trail.map((step, i) => (
                  <div
                    key={`${step}-${i}`}
                    className={`flex items-start gap-2 text-[10px] transition-opacity ${
                      i === trail.length - 1
                        ? 'text-[var(--foreground)]'
                        : 'text-[var(--muted-foreground)] opacity-60'
                    }`}
                  >
                    {i === trail.length - 1 ? (
                      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--primary)] motion-safe:animate-pulse" />
                    ) : (
                      <CheckIcon className="mt-px h-3 w-3 flex-shrink-0 opacity-60" />
                    )}
                    <span className="min-w-0">{step}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    {trail.length === 0
                      ? 'Thinking'
                      : `Working through ${trail.length} step${trail.length === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 rounded-lg px-3 py-2 border border-[var(--destructive)]/20">
                {error}
              </div>
            )}
            </div>
          </div>

          {/* Input area */}
          <div className="p-3">
            {/* Same column as the conversation above (mx-auto max-w-2xl). A
                full-width composer under a centred thread reads as two different
                layouts stacked, and at expanded width the field ran metres wider
                than the text it was answering. */}
            <div className="mx-auto w-full max-w-2xl">
            {/* `block` on the textarea is load-bearing: a textarea is inline-level
                by default, so its wrapper picked up ~2px of descender space and
                sat taller than the field itself — which is why the absolutely
                positioned send button never lined up no matter what offset it
                was given. */}
            {/* The input is the whole field: send sits INSIDE it, on the right,
                the way every messaging surface does it — the button belongs to the
                thing you are typing in. Attach and dictate move below, because
                they act on the draft rather than submitting it, and crowding four
                controls onto one line made the field itself the smallest part. */}
            <div className="relative">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={dictating ? 'Listening…' : 'Ask anything...'}
                rows={1}
                className="block w-full resize-none bg-[var(--input)] border border-[var(--border)] rounded-xl pl-3 pr-11 py-2.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors max-h-32"
              />
              {loading ? (
                <button
                  type="button"
                  onClick={stopResponding}
                  title="Stop"
                  aria-label="Stop responding"
                  className="absolute right-2 bottom-[5px] p-1.5 rounded-lg text-[var(--foreground)] bg-[var(--muted)] hover:bg-[var(--border)] transition-colors"
                >
                  <StopIcon className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!prompt.trim()}
                  title="Send"
                  aria-label="Send"
                  className="absolute right-2 bottom-[5px] p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <PaperAirplaneIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Equal breathing room above and below — these sit right on the
                panel's bottom edge otherwise. */}
            <div className="my-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={attachFile}
                title="Attach a text file"
                aria-label="Attach a text file"
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <PaperClipIcon className="w-4 h-4" />
              </button>
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  title={dictating ? 'Stop dictating' : 'Dictate'}
                  aria-label={dictating ? 'Stop dictating' : 'Dictate'}
                  aria-pressed={dictating}
                  className={`p-1.5 rounded-lg transition-colors ${
                    dictating
                      ? 'text-[var(--destructive)] bg-[var(--muted)]'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <MicrophoneIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ── Specialist nudge ──
           Sits directly above the bubble and only where a specialist is relevant.
           Hidden while the panel is open: once you're talking to it, the invitation
           to talk to it is just clutter. */}
      {hint && !isOpen && (
        <div className="fixed bottom-[4.75rem] right-6 z-50 pointer-events-none">
          <AgentTeaser
            // Keyed on the teaser copy, so moving to a page whose ask is different
            // — or to a different specialist entirely — animates in fresh instead of
            // silently swapping text. Moving between two pages that share a nudge
            // (the ad builder and its queue) leaves it alone.
            key={hint.teaser}
            hint={hint}
            onAsk={(question) => {
              setPrompt(question);
              setIsOpen(true);
              setTimeout(() => inputRef.current?.focus(), 200);
            }}
          />
        </div>
      )}

      {/* ── Floating Bubble ──
           Hidden while the panel is open. It used to become an X, which worked
           when the panel floated ABOVE the page — now the panel is docked to the
           same corner, so the button landed on top of the composer. The header's
           X is the close affordance; this is purely the way in. */}
      {!isOpen && (
      <button
        ref={bubbleRef}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ai-horizon-fab text-zinc-900"
        title={`Ask ${identity.name} (⌘J)`}
        aria-label={`Ask ${identity.name}`}
      >
        {isSystem ? (
          <SparklesIcon className="w-5 h-5" />
        ) : (
          <AgentAvatar identity={identity} size="md" />
        )}
      </button>
      )}
    </>
  );
}
