'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PaperAirplaneIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { FlowAiAction, FlowSnapshot } from '@/lib/ai/flow-tools';

// Chat panel that slots into the left rail when the user opens Loomi AI.
// Replaces the BuilderPalette while open. Communicates with the FlowBuilder
// via two props:
//   - getSnapshot(): freshest view of the canvas + triggers, sent on every
//     turn so the model isn't reasoning about stale state
//   - onApplyActions(actions): hands the model's edits to the builder so
//     they go through the same setNodes/setEdges/triggers handlers a user
//     click would. Returns once the actions have been applied.

interface FlowAiPanelProps {
  flowId: string;
  getSnapshot: () => FlowSnapshot;
  onApplyActions: (actions: FlowAiAction[]) => Promise<void> | void;
  onClose: () => void;
  /** Optional initial prompt pulled from the empty-state hero. */
  initialPrompt?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** How many graph mutations this assistant turn applied. Surfaced as a
   *  small chip under the bubble so the user knows the canvas changed. */
  appliedActions?: number;
}

const PRESETS = [
  'Build a 5-day post-service follow-up',
  'Add a 2-day wait after the first email',
  'Branch on whether they opened the previous email',
  'What does this flow do?',
];

export function FlowAiPanel({
  flowId,
  getSnapshot,
  onApplyActions,
  onClose,
  initialPrompt,
}: FlowAiPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the input on mount so typing flows immediately into the panel.
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  // Auto-scroll to the latest message when history grows or loading flips.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [history, loading]);

  const sendMessage = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setPrompt('');
    setError('');
    setLoading(true);

    // Snapshot the current history (the API needs to see what the user
    // typed earlier in the conversation) plus the new user turn.
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextHistory: ChatMessage[] = [...history, userMsg];
    setHistory(nextHistory);

    try {
      const res = await fetch(`/api/flows/${flowId}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          // Pull the freshest snapshot from the builder — the user may have
          // dragged something onto the canvas between turns and the model
          // should see that.
          snapshot: getSnapshot(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Request failed');
        return;
      }

      // Apply graph mutations first so the canvas updates before the
      // assistant bubble references "the new email" or whatever else.
      const actions: FlowAiAction[] = Array.isArray(data.actions) ? data.actions : [];
      if (actions.length > 0) {
        await onApplyActions(actions);
      }

      const reply: string = typeof data.reply === 'string' ? data.reply : '';
      setHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply || 'Done.',
          appliedActions: actions.length,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, history, flowId, getSnapshot, onApplyActions]);

  // Run the initial prompt once when the panel mounts with one queued.
  const initialFiredRef = useRef(false);
  useEffect(() => {
    if (initialFiredRef.current) return;
    if (!initialPrompt) return;
    initialFiredRef.current = true;
    // Defer one tick so the input has been populated + the user sees
    // their prompt appear before we send.
    setTimeout(() => void sendMessage(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const clearChat = () => {
    setHistory([]);
    setError('');
  };

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col rounded-xl overflow-hidden ai-assist-panel">
      {/* Header — mirrors the BuilderPalette header layout so swapping
          between the two doesn't feel jarring. */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center flex-shrink-0">
            <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
              Loomi AI
            </h3>
            <p className="text-[10px] text-[var(--muted-foreground)] truncate">
              Ask, edit, explain.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
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
          <button
            type="button"
            onClick={onClose}
            title="Close (show palette)"
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--ai-ed-hover)] transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thread */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ai-assist-thread"
      >
        {history.length === 0 && !loading && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full ai-horizon-orb-soft flex items-center justify-center">
              <SparklesIcon className="w-5 h-5 text-zinc-900" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)] mb-1">
                What do you want to build?
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] leading-snug">
                Describe the flow you want, ask about the current one, or pick
                a preset.
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
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-[var(--primary)] text-white rounded-xl rounded-br-sm px-3 py-2">
                  <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="max-w-[92%] border border-[var(--border)] rounded-xl rounded-bl-sm px-3 py-2 ai-assist-assistant-message">
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">
                    {msg.content}
                  </p>
                </div>
                {typeof msg.appliedActions === 'number' && msg.appliedActions > 0 && (
                  <p className="ml-1 text-[10px] text-[var(--muted-foreground)]">
                    Applied {msg.appliedActions} change
                    {msg.appliedActions === 1 ? '' : 's'} — ⌘Z to undo.
                  </p>
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

      {/* Composer */}
      <div className="p-3 border-t border-[var(--border)]">
        <div className="flex items-end gap-2">
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
            className="flex-1 resize-none bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors max-h-24"
          />
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
    </aside>
  );
}
