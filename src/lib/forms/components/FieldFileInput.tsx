'use client';

/**
 * Interactive file-upload field for the public form.
 *
 * A styled drop zone backed by a hidden native `<input type="file">`. The
 * input is kept in sync with the visible file list via a DataTransfer, so
 * the form's existing `new FormData(form)` submission carries exactly the
 * files shown here — no bespoke submit wiring needed. Supports drag-and-
 * drop, click-to-browse, accumulating selections across multiple picks,
 * and per-file removal (the gap the native input can't fill).
 */
import * as React from 'react';
import { FieldShell, inputStyle, type FieldFileProps } from './fields';
import {
  FILE_ACCEPT_ATTR,
  MAX_FILE_SIZE_MB,
  ALLOWED_FILE_TYPES_LABEL,
} from '../file-upload';

/**
 * Whether the file field is mounted in the live public form (uploads
 * enabled) vs. a preview context — the editor canvas, the admin overview,
 * and the thumbnail. Defaults to `false` so every non-live surface renders
 * an inert drop zone: no file dialog on click, no drag-and-drop capture,
 * so the block can be selected and dragged around the editor freely. The
 * public form flips this on via the provider.
 */
export const FormInteractiveContext = React.createContext(false);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block' }}>
      <path
        d="M12 16V4m0 0L7 9m5-5l5 5M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path
        d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9m-7-7l7 7m-7-7v7h7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const FieldFile: React.FC<FieldFileProps> = (props) => {
  const id = props.name || undefined;
  const interactive = React.useContext(FormInteractiveContext);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [dragOver, setDragOver] = React.useState(false);

  const accent = props.inputBorderColor || '#d4d4d4';
  const radius = props.inputBorderRadius ?? 6;
  const textColor = props.inputTextColor || '#1a1a1a';

  // Preview surfaces (editor, overview, thumbnail): render an inert drop
  // zone. No input, no click target, no drag handlers — so selecting and
  // dragging the block in the editor isn't hijacked by the upload UI.
  if (!interactive) {
    return (
      <FieldShell {...props}>
        <div
          style={{
            ...inputStyle(props),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            textAlign: 'center',
            padding: '22px 16px',
            border: `1.5px dashed ${accent}`,
            borderRadius: `${radius}px`,
            backgroundColor: props.inputBgColor || '#ffffff',
            color: textColor,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ color: textColor, opacity: 0.7 }}>
            <UploadIcon />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Click to upload{props.multiple ? ' files' : ''} or drag & drop
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {ALLOWED_FILE_TYPES_LABEL} · up to {MAX_FILE_SIZE_MB}MB{props.multiple ? ' each' : ''}
          </span>
        </div>
      </FieldShell>
    );
  }

  // Push the given files into the hidden native input so the form's
  // FormData submission stays in lockstep with what's shown.
  const commit = React.useCallback((next: File[]) => {
    const input = inputRef.current;
    if (input && typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      input.files = dt.files;
    }
    setFiles(next);
  }, []);

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (list.length === 0) return;
      if (!props.multiple) {
        commit(list.slice(-1));
        return;
      }
      // Accumulate + de-dupe so re-opening the picker adds rather than
      // replaces, and the same file can't be added twice.
      const seen = new Set(files.map(fileKey));
      const merged = [...files];
      for (const f of list) {
        if (!seen.has(fileKey(f))) {
          seen.add(fileKey(f));
          merged.push(f);
        }
      }
      commit(merged);
    },
    [commit, files, props.multiple],
  );

  const removeAt = (index: number) => {
    commit(files.filter((_, i) => i !== index));
  };

  return (
    <FieldShell {...props} htmlFor={id}>
      {/* Real input — visually hidden, kept in sync via DataTransfer. */}
      <input
        ref={inputRef}
        id={id}
        type="file"
        name={props.name}
        accept={FILE_ACCEPT_ATTR}
        multiple={props.multiple}
        onChange={(e) => addFiles(e.target.files ?? [])}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        tabIndex={-1}
      />

      {/* Drop zone / browse trigger. */}
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
        }}
        style={{
          ...inputStyle(props),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          textAlign: 'center',
          padding: '22px 16px',
          border: `1.5px dashed ${dragOver ? textColor : accent}`,
          borderRadius: `${radius}px`,
          backgroundColor: dragOver ? 'rgba(0,0,0,0.03)' : props.inputBgColor || '#ffffff',
          color: textColor,
          cursor: 'pointer',
          transition: 'border-color .15s, background-color .15s',
        }}
      >
        <span style={{ color: textColor, opacity: 0.7 }}>
          <UploadIcon />
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          Click to upload{props.multiple ? ' files' : ''} or drag & drop
        </span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {ALLOWED_FILE_TYPES_LABEL} · up to {MAX_FILE_SIZE_MB}MB{props.multiple ? ' each' : ''}
        </span>
      </label>

      {/* Selected files with per-file removal. */}
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((file, index) => (
            <li
              key={fileKey(file)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: `1px solid ${accent}`,
                borderRadius: `${Math.max(4, radius - 2)}px`,
                backgroundColor: 'rgba(0,0,0,0.02)',
                fontSize: 13,
                color: textColor,
              }}
            >
              <span style={{ opacity: 0.6 }}>
                <DocIcon />
              </span>
              <span
                style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={file.name}
              >
                {file.name}
              </span>
              <span style={{ opacity: 0.55, flexShrink: 0, fontSize: 12 }}>{formatSize(file.size)}</span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`Remove ${file.name}`}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  border: 'none',
                  borderRadius: 6,
                  background: 'transparent',
                  color: textColor,
                  opacity: 0.55,
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </FieldShell>
  );
};
