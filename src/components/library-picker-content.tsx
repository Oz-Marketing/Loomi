'use client';

import { useEffect, useState, useMemo } from 'react';
import { MagnifyingGlassIcon, BookOpenIcon } from '@heroicons/react/24/outline';
import { TemplatePreview } from '@/components/template-preview';
import { parseTemplateTagsPayload, type TemplateTagAssignments } from '@/lib/template-tags-payload';

interface LibraryTemplate {
  design: string;
  name: string;
}

interface TagData {
  tags: string[];
  assignments: TemplateTagAssignments;
}

interface LibraryPickerContentProps {
  onSelect: (designSlug: string) => void;
}

export function LibraryPickerContent({ onSelect }: LibraryPickerContentProps) {
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch templates + tags in parallel on mount
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/templates?publishedOnly=true').then(r => r.ok ? r.json() : []),
      fetch('/api/template-tags').then(r => r.ok ? r.json() : { tags: [], assignments: [] }),
    ])
      .then(([tData, tagResult]) => {
        if (cancelled) return;
        setTemplates(
          Array.isArray(tData)
            ? tData.map((t: { design: string; name: string }) => ({ design: t.design, name: t.name }))
            : [],
        );
        setTagData(parseTemplateTagsPayload(tagResult));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Filter by tag then search
  const filtered = useMemo(() => {
    let list = templates;

    if (selectedTag) {
      list = list.filter(t => (tagData.assignments[t.design] || []).includes(selectedTag));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        t => t.name.toLowerCase().includes(q) || t.design.toLowerCase().includes(q),
      );
    }

    return list;
  }, [templates, selectedTag, search, tagData]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-[var(--border)] p-4 flex flex-col gap-4">
        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            autoFocus
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          />
        </div>

        {/* Tags */}
        {tagData.tags.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1">Tags</p>
            <button
              onClick={() => setSelectedTag(null)}
              className={`text-xs px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                !selectedTag
                  ? 'bg-[var(--primary)] text-white font-medium'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              All
            </button>
            {tagData.tags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`text-xs px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  selectedTag === tag
                    ? 'bg-[var(--primary)] text-white font-medium'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Template count */}
        <div className="mt-auto pt-2">
          <p className="text-[10px] text-[var(--muted-foreground)]">
            {loading ? 'Loading...' : `${filtered.length} template${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass-card rounded-xl overflow-hidden animate-pulse">
                <div className="h-[180px] bg-[var(--muted)]" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-[var(--muted)] rounded w-3/4" />
                  <div className="h-2 bg-[var(--muted)] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)]">
            <BookOpenIcon className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">
              {search || selectedTag ? 'No templates were found.' : 'No library templates available.'}
            </p>
            {!search && !selectedTag && (
              <p className="text-xs mt-1">Create templates in the Template Library first.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(t => {
              const tags = tagData.assignments[t.design] || [];
              return (
                <button
                  key={t.design}
                  onClick={() => onSelect(t.design)}
                  className="group glass-card rounded-xl overflow-hidden text-left transition-all hover:border-[var(--primary)]"
                >
                  <TemplatePreview design={t.design} height={180} />
                  <div className="p-3">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    {tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {tags.map(tag => (
                          <span
                            key={tag}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
