'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowLeftEndOnRectangleIcon,
  BoltIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { LpApplyMode } from '@/lib/ai/lp-assistant';

// Iris chat for the HTML landing-page editor. Lives in the left pane as a tab
// alongside the Monaco editor (see LandingPageHtmlEditorShell). It talks to
// POST /api/landing-pages/[id]/ai/chat and applies Iris's HTML through the
// editor's own handlers so autosave + undo/redo come for free:
//   - onReplaceHtml(html): swap the whole page body
//   - onInsertHtml(html):  drop a section at the Monaco cursor
// getHtml() returns the freshest body HTML, sent on every turn so Iris reasons
// about the current page (the user may have hand-edited it between messages).

interface LpAiPanelProps {
  pageId: string;
  getHtml: () => string;
  onReplaceHtml: (html: string) => void;
  onInsertHtml: (html: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Assistant turns may carry HTML Iris produced this turn. */
  html?: string | null;
  htmlMode?: LpApplyMode;
  changeNotes?: string[];
  suggestions?: string[];
  /** Whether the HTML has been applied to the page (auto, or via the button). */
  applied?: boolean;
}

type ApplyMode = 'auto' | 'propose';

const PRESETS = [
  'Build a lead-gen page for a spring service special',
  'Make the hero headline punchier',
  'Add a testimonials section',
  'What would improve this page’s conversion?',
];

export function LpAiPanel({ pageId, getHtml, onReplaceHtml, onInsertHtml }: LpAiPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applyMode, setApplyMode] = useState<ApplyMode>('auto');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to the latest message as the thread grows or loading flips.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, loading]);

  // Apply Iris's HTML through the editor's handlers.
  const applyHtml = useCallback(
    (html: string, mode: LpApplyMode) => {
      if (mode === 'insert') onInsertHtml(html);
      else onReplaceHtml(html);
    },
    [onInsertHtml, onReplaceHtml],
  );

  const sendMessage = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setPrompt('');
    setError('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextHistory: ChatMessage[] = [...history, userMsg];
    setHistory(nextHistory);

    try {
      const res = await fetch(`/api/landing-pages/${pageId}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          // Freshest page HTML — the user may have hand-edited between turns.
          html: getHtml(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Request failed');
        return;
      }

      const html: string | null = typeof data.html === 'string' && data.html.trim() ? data.html : null;
      const htmlMode: LpApplyMode =
        data.mode === 'replace' || data.mode === 'insert' || data.mode === 'none' ? data.mode : 'none';

      // Auto-apply mode: apply immediately so the live preview updates before the
      // assistant bubble references "the new section".
      let applied = false;
      if (html && htmlMode !== 'none' && applyMode === 'auto') {
        applyHtml(html, htmlMode);
        applied = true;
      }

      const reply: string = typeof data.reply === 'string' && data.reply.trim() ? data.reply : 'Done.';
      setHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply,
          html,
          htmlMode,
          changeNotes: Array.isArray(data.changeNotes) ? data.changeNotes : [],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          applied,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, history, pageId, getHtml, applyMode, applyHtml]);

  // Apply a proposed turn's HTML on demand (Propose mode), marking it applied.
  // Apply happens OUTSIDE the state updater — running a side effect inside one
  // would double-fire under React StrictMode and apply the HTML twice.
  const applyMessage = useCallback(
    (index: number) => {
      const msg = history[index];
      if (!msg || !msg.html || !msg.htmlMode || msg.htmlMode === 'none' || msg.applied) return;
      applyHtml(msg.html, msg.htmlMode);
      setHistory((prev) => {
        const target = prev[index];
        if (!target || target.applied) return prev;
        const next = [...prev];
        next[index] = { ...target, applied: true };
        return next;
      });
    },
    [history, applyHtml],
  );

  const clearChat = () => {
    setHistory([]);
    setError('');
  };

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden ai-assist-panel">
      {/* Header — orb + Iris identity, clear. */}
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center flex-shrink-0">
            <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--foreground)] truncate leading-tight">Iris</h3>
            <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
              Design, write, refine.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {history.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              title="Clear conversation"
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ai-assist-thread">
        {history.length === 0 && !loading && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full ai-horizon-orb-soft flex items-center justify-center">
              <SparklesIcon className="w-5 h-5 text-zinc-900" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)] mb-1">What page do you want to build?</p>
              <p className="text-[11px] text-[var(--muted-foreground)] leading-snug">
                Describe your goal and offer — I’ll ask a couple of questions if I need them, then build it.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 px-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPrompt(preset)}
                  className="text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, idx) => (
          <div key={`chat-${idx}`}>
            {msg.role === 'user' ? (
              // Claude-style: the user's turn is a soft gray pill on the right.
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-[var(--muted)] text-[var(--foreground)] rounded-2xl px-3.5 py-2">
                  <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              // Claude-style: Iris replies as plain text on the left, no bubble.
              <div className="space-y-2">
                <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">
                  {msg.content}
                </p>

                {msg.changeNotes && msg.changeNotes.length > 0 && (
                  <ul className="space-y-0.5">
                    {msg.changeNotes.map((note, i) => (
                      <li
                        key={i}
                        className="text-[11px] text-[var(--muted-foreground)] leading-snug flex gap-1.5"
                      >
                        <span className="text-[var(--primary)]">•</span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Applied chip (auto, or after the user clicks Apply). */}
                {msg.html && msg.htmlMode && msg.htmlMode !== 'none' && msg.applied && (
                  <p className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
                    <CheckCircleIcon className="w-3 h-3 text-emerald-500" />
                    {msg.htmlMode === 'insert' ? 'Inserted at cursor' : 'Applied to page'} — ⌘Z to undo.
                  </p>
                )}

                {/* Propose mode: offer an Apply / Insert action. */}
                {msg.html && msg.htmlMode && msg.htmlMode !== 'none' && !msg.applied && (
                  <button
                    type="button"
                    onClick={() => applyMessage(idx)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-colors"
                  >
                    {msg.htmlMode === 'insert' ? (
                      <>
                        <ArrowLeftEndOnRectangleIcon className="w-3.5 h-3.5" />
                        Insert at cursor
                      </>
                    ) : (
                      <>
                        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                        Apply to page
                      </>
                    )}
                  </button>
                )}

                {/* Suggestion chips — tap to queue the next ask. */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {msg.suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setPrompt(s);
                          inputRef.current?.focus();
                        }}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
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
            <p className="text-[10px] text-[var(--muted-foreground)]">Thinking…</p>
          </div>
        )}

        {error && (
          <div className="text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 rounded-lg px-3 py-2 border border-[var(--destructive)]/20">
            {error}
          </div>
        )}
      </div>

      {/* Composer — input box with controls along the bottom (Claude-style):
          apply-mode dropdown on the left, send on the right. */}
      <div className="p-3 border-t border-[var(--border)]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--input)] focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)] transition-colors">
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
            placeholder="Describe what you want…"
            rows={1}
            className="w-full resize-none bg-transparent border-0 px-3 pt-2.5 pb-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none max-h-24"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <ApplyModeDropdown mode={applyMode} onChange={setApplyMode} />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!prompt.trim() || loading}
              className="ai-ed-primary-btn p-2 rounded-lg disabled:opacity-40 transition-opacity flex-shrink-0"
              title="Send"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const APPLY_MODE_OPTIONS: Array<{ value: ApplyMode; label: string; desc: string }> = [
  { value: 'auto', label: 'Auto-apply', desc: 'Changes apply to the page instantly (⌘Z to undo)' },
  { value: 'propose', label: 'Propose', desc: 'Review each change, then click to apply' },
];

/** Apply-mode picker for the composer — a small dropdown that opens upward
 *  (it sits at the bottom of the panel). Replaces the old header toggle. */
function ApplyModeDropdown({ mode, onChange }: { mode: ApplyMode; onChange: (m: ApplyMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = APPLY_MODE_OPTIONS.find((o) => o.value === mode) ?? APPLY_MODE_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="How Iris applies its changes"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <BoltIcon className="w-3.5 h-3.5" />
        {current.label}
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{ transformOrigin: 'bottom left' }}
          className="absolute bottom-full left-0 mb-1.5 w-60 glass-dropdown p-1 z-30"
        >
          {APPLY_MODE_OPTIONS.map((opt) => {
            const active = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                  active ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]'
                }`}
              >
                <CheckIcon
                  className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${active ? 'text-[var(--primary)]' : 'text-transparent'}`}
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-[var(--foreground)]">{opt.label}</span>
                  <span className="block text-[10px] text-[var(--muted-foreground)] leading-snug">{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
