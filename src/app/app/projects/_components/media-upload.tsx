'use client';

import { useRef, useState } from 'react';
import { ArrowUpTrayIcon, PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';

export type UploadedFile = { id: string; name: string; url: string };

// Account-scoped media upload — POSTs each file to /api/media (same endpoint the
// campaign builder uses) and tracks the returned {id,name,url}. Needs an account
// selected (media is account-scoped); for a multi-account ticket the caller
// passes the primary account.
export function MediaUpload({
  accountKey,
  value,
  onChange,
}: {
  accountKey: string | null;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    if (!accountKey) {
      toast.error('Pick an account first');
      return;
    }
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('accountKey', accountKey);
        fd.append('category', 'project-intake');
        const res = await fetch('/api/media', { method: 'POST', body: fd });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `Could not upload ${file.name}`);
        }
        const { file: f } = await res.json();
        uploaded.push({ id: f.id, name: f.name, url: f.url });
      }
      onChange([...value, ...uploaded]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => accountKey && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && accountKey) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (!accountKey) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (accountKey) handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition ${
          !accountKey
            ? 'cursor-not-allowed border-[var(--border)] text-[var(--muted-foreground)] opacity-60'
            : dragging
              ? 'cursor-pointer border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--foreground)]'
              : 'cursor-pointer border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
        }`}
      >
        <ArrowUpTrayIcon className="h-5 w-5" />
        <span>
          {uploading
            ? 'Uploading…'
            : !accountKey
              ? 'Pick an account first'
              : dragging
                ? 'Drop files to upload'
                : 'Drag & drop files here, or click to browse'}
        </span>
      </div>

      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((f) => (
            <li
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--muted)] px-2 py-1 text-xs"
            >
              <PaperClipIcon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-[12rem] truncate text-[var(--foreground)] hover:underline"
              >
                {f.name}
              </a>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                className="rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
