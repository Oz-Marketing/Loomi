'use client';

import { useEffect, useState } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { CodeEditor } from '@/components/code-editor';
import PrimaryButton from '@/components/primary-button';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';

// Extracted from src/app/settings/page.tsx: a Next.js page file may only export
// a default component plus Next's reserved names, so exporting this tab from
// there to share it with the Agency Settings modal broke the build with
// "does not match the required types of a Next.js Page". `tsc --noEmit` doesn't
// check that constraint — only `next build` does.
// Knowledge Base Tab
// ════════════════════════════════════════
export function KnowledgeBaseTab() {
  const { markClean, markDirty } = useUnsavedChanges();
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const hasChanges = content !== savedContent;

  useEffect(() => {
    if (hasChanges) {
      markDirty();
    } else {
      markClean();
    }
    // markClean/markDirty are stable refs from context — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  useEffect(() => {
    fetch('/api/knowledge')
      .then(r => r.json())
      .then(data => {
        const c = data.content || '';
        setContent(c);
        setSavedContent(c);
      })
      .catch(() => toast.error('Failed to load knowledge base'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setSavedContent(content);
        markClean();
        toast.success('Knowledge base saved! AI will use the updated content immediately.');
      } else {
        toast.error('Failed to save knowledge base');
      }
    } catch {
      toast.error('Failed to save knowledge base');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Loading knowledge base...</p>
      </div>
    );
  }

  const sectionCardClass = 'glass-section-card rounded-xl p-5';

  return (
    <div className="max-w-7xl grid grid-cols-1 gap-6">
      <section className={sectionCardClass}>
        <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--ai-assist-border)] bg-[var(--ai-hz-chip-bg)]">
          <span className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center flex-shrink-0 mt-0.5">
            <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">AI Knowledge Base</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              This markdown file powers both AI assistants (the global Loomi bubble and the template editor sidebar). Edit it to update what the AI knows about your platform, processes, and conventions. Changes take effect immediately.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                !showPreview
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
              }`}
            >
              Editor
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                showPreview
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
              }`}
            >
              Preview
            </button>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>
            )}
            <PrimaryButton
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      </section>

      <section className="glass-section-card rounded-xl p-0 overflow-hidden">
        {!showPreview ? (
          <div style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
            <CodeEditor
              value={content}
              onChange={setContent}
              language="markdown"
              onSave={handleSave}
            />
          </div>
        ) : (
          <div
            className="overflow-auto p-6"
            style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownPreview content={content} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// Simple markdown renderer — no external dependencies
function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-[var(--foreground)] mt-6 mb-3 first:mt-0">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-semibold text-[var(--foreground)] mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-[var(--foreground)] mt-4 mb-1.5">{line.slice(4)}</h3>);
    }
    // Horizontal rule
    else if (line.trim() === '---') {
      elements.push(<hr key={i} className="border-[var(--border)] my-4" />);
    }
    // Code block
    else if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-[var(--muted)] rounded-lg p-3 text-xs overflow-x-auto my-2 border border-[var(--border)]">
          <code className="text-[var(--foreground)]">{codeLines.join('\n')}</code>
        </pre>
      );
    }
    // Table (basic)
    else if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      i--; // back up since outer loop will increment
      const headerCells = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
      const bodyRows = tableLines.slice(2); // skip header + separator
      elements.push(
        <div key={`table-${i}`} className="overflow-x-auto my-3">
          <table className="w-full text-xs border border-[var(--border)] rounded-lg">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {headerCells.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-medium text-[var(--muted-foreground)]">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
                return (
                  <tr key={ri} className="border-b border-[var(--border)] last:border-0">
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-[var(--foreground)]">{renderInline(cell)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    // List items
    else if (line.trimStart().startsWith('- ')) {
      const indent = line.length - line.trimStart().length;
      elements.push(
        <div key={i} className="flex gap-2 text-xs text-[var(--foreground)]" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-[var(--muted-foreground)] flex-shrink-0">&#x2022;</span>
          <span>{renderInline(line.trimStart().slice(2))}</span>
        </div>
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line.trimStart())) {
      const match = line.trimStart().match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 text-xs text-[var(--foreground)] pl-2">
            <span className="text-[var(--muted-foreground)] flex-shrink-0 w-4 text-right">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        );
      }
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    }
    // Paragraph
    else {
      elements.push(
        <p key={i} className="text-xs leading-relaxed text-[var(--foreground)]">
          {renderInline(line)}
        </p>
      );
    }

    i++;
  }

  return <>{elements}</>;
}

// Inline markdown rendering: bold, italic, code, links
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(<code key={match.index} className="px-1 py-0.5 rounded bg-[var(--muted)] text-[var(--primary)] text-[11px] font-mono">{match[6]}</code>);
    } else if (match[7]) {
      parts.push(<span key={match.index} className="text-[var(--primary)] underline">{match[8]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}
