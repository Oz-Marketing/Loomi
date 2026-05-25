'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import {
  AI_ASSIST_OPEN_EVENT,
  TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT,
} from '@/lib/ui-events';
import {
  SparklesIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
}

const PRESETS = [
  'How do I create an email?',
  'What template types exist?',
  'How do I connect an integration?',
];

export function AiBubble() {
  const pathname = usePathname();
  const { accountKey, accountData, userRole, userName, isAdmin } = useAccount();

  const [isOpen, setIsOpen] = useState(false);
  const [isTemplateAiSidebarOpen, setIsTemplateAiSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  // ── Visibility: hide on template editor, login, preview ──
  const isTemplateEditor =
    pathname === '/templates/editor' ||
    /^\/templates\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/templates\/folder\/[^/]+$/.test(pathname) ||
    /^\/components\/[^/]+$/.test(pathname) ||
    /^\/components\/folder\/[^/]+$/.test(pathname);
  // The flow builder ships its own embedded AI ("Iris" panel on the
  // left rail) — hide the global bubble so we don't end up with two
  // entry points stacked on the canvas.
  const isFlowBuilder =
    /^\/flows\/[^/]+$/.test(pathname) ||
    /^\/subaccount\/[^/]+\/flows\/[^/]+$/.test(pathname);
  const isFullScreen =
    pathname.startsWith('/preview') ||
    pathname.startsWith('/login') ||
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
          setIsOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isTemplateEditor]);

  // ── Open from header Help action ──
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 200);
    };

    window.addEventListener(AI_ASSIST_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(AI_ASSIST_OPEN_EVENT, handleOpen);
  }, []);

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

  // ── Click-outside to close ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        bubbleRef.current &&
        !bubbleRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setPrompt('');
    setError('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    setHistory((prev) => [...prev, userMsg]);

    try {
      const apiHistory = history.slice(-10).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          history: apiHistory,
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
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, history, pathname, accountKey, accountData, userRole, userName, isAdmin]);

  const clearChat = () => {
    setHistory([]);
    setError('');
  };

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
        title="Ask Iris (⌘J)"
      >
        <SparklesIcon className="w-5 h-5" />
      </button>
    );
  }

  // Hide bubble when template AI sidebar is open on non-editor pages
  if (isTemplateAiSidebarOpen) return null;

  return (
    <>
      {/* ── Chat Panel ── */}
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed bottom-20 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] rounded-2xl overflow-hidden flex flex-col ai-assist-panel animate-chat-panel-in"
          style={{
            maxHeight: 'min(70vh, 560px)',
            transformOrigin: 'bottom right',
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center">
                <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
              </div>
              <span className="text-sm font-semibold text-[var(--foreground)]">
                Ask Iris
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded">
                ⌘J
              </span>
            </div>
            <div className="flex items-center gap-1">
              {history.length > 0 && (
                <button
                  onClick={clearChat}
                  title="Clear conversation"
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                title="Close"
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Context bar */}
          <div className="px-3 py-1.5 border-b border-[var(--border)] ai-assist-context text-[10px] text-[var(--muted-foreground)] flex items-center gap-2">
            <span className="truncate">
              {accountData?.dealer || (isAdmin ? 'Admin mode' : 'No account')}
            </span>
            <span className="opacity-40">·</span>
            <span className="truncate opacity-60">{pathname}</span>
          </div>

          {/* Message thread */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] ai-assist-thread"
          >
            {/* Empty state */}
            {history.length === 0 && !loading && (
              <div className="text-center py-6 space-y-3">
                <div className="w-10 h-10 mx-auto rounded-full ai-horizon-orb-soft flex items-center justify-center">
                  <SparklesIcon className="w-5 h-5 text-zinc-900" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)] mb-1">
                    Hey! I&apos;m Iris.
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Ask me anything about Loomi Studio
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                  {PRESETS.map((preset) => (
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
              <div key={`chat-${idx}`}>
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    {/* Neutral primary-tinted bubble for user messages.
                        Earlier this was a pink gradient with white text;
                        the brand surface is now the panel outline, not
                        each message. */}
                    <div className="max-w-[85%] bg-[var(--primary)] text-white rounded-xl rounded-br-sm px-3 py-2">
                      <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="max-w-[90%] border border-[var(--border)] rounded-xl rounded-bl-sm px-3 py-2 ai-assist-assistant-message">
                      <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">
                        {msg.content}
                      </p>
                    </div>
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

            {/* Loading indicator */}
            {loading && (
              <div className="flex items-center gap-2 px-1">
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
                  Thinking...
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 rounded-lg px-3 py-2 border border-[var(--destructive)]/20">
                {error}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="p-3 border-t border-[var(--border)]">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask anything..."
                rows={1}
                className="flex-1 resize-none bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors max-h-20"
              />
              <button
                onClick={sendMessage}
                disabled={!prompt.trim() || loading}
                className="ai-ed-primary-btn p-2 rounded-lg disabled:opacity-40 transition-opacity flex-shrink-0"
                title="Send"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Bubble ── */}
      <button
        ref={bubbleRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ${
          isOpen
            ? 'bg-[var(--muted)] text-[var(--muted-foreground)] shadow-none hover:shadow-none'
            : 'ai-horizon-fab text-zinc-900'
        }`}
        title="Ask Iris (⌘J)"
      >
        {isOpen ? (
          <XMarkIcon className="w-5 h-5" />
        ) : (
          <SparklesIcon className="w-5 h-5" />
        )}
      </button>
    </>
  );
}
