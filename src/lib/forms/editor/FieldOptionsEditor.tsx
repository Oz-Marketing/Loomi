'use client';

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Option {
  label: string;
  value: string;
}

interface FieldOptionsEditorProps {
  options: Option[];
  onChange: (options: Option[]) => void;
}

// Repeater UI for the `options` prop on select/radio/checkbox field blocks.
// The selected block's BlockProperties panel renders one of these when it
// detects the block type carries an options array.
export function FieldOptionsEditor({ options, onChange }: FieldOptionsEditorProps) {
  const updateAt = (idx: number, patch: Partial<Option>) => {
    const next = options.map((opt, i) => (i === idx ? { ...opt, ...patch } : opt));
    onChange(next);
  };

  const removeAt = (idx: number) => {
    onChange(options.filter((_, i) => i !== idx));
  };

  const addOption = () => {
    const n = options.length + 1;
    onChange([...options, { label: `Option ${n}`, value: `option-${n}` }]);
  };

  return (
    <div className="space-y-2">
      {options.map((opt, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="text"
            value={opt.label}
            onChange={(e) => updateAt(idx, { label: e.target.value })}
            placeholder="Label"
            className="flex-1 px-2 py-1.5 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors"
          />
          <input
            type="text"
            value={opt.value}
            onChange={(e) => updateAt(idx, { value: e.target.value })}
            placeholder="value"
            className="flex-1 px-2 py-1.5 text-sm bg-transparent text-[var(--muted-foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => removeAt(idx)}
            className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-red-500 hover:bg-[var(--muted)] transition-colors"
            title="Remove option"
            aria-label="Remove option"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-dashed border-[var(--border)] rounded-md hover:bg-[var(--muted)] transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add option
      </button>
    </div>
  );
}
