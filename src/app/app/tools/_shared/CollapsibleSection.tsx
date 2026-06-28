'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

// Same divider look as <Divider>, but the header is a toggle: click it to
// height-animate the section open/closed (chevron rotates). The section's
// dropdowns (StatusSelect/DatePicker portal, UserPicker is a native select) all
// escape the collapse's overflow clip, so nothing gets cut off when open.
export function CollapsibleSection({
  icon,
  label,
  defaultOpen = true,
  children,
}: {
  icon?: ReactNode;
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Expand/collapse is a VIEW action, so the toggle must keep working even when
  // the form is read-only (frozen month). The editor wraps the form in a
  // <fieldset disabled>, which would disable a real <button> here — so this is a
  // div-button (not form-associated, immune to the ancestor fieldset).
  const toggle = () => setOpen((v) => !v);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
        className="group flex w-full items-center gap-2.5 my-4 cursor-pointer select-none"
      >
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap transition-colors group-hover:text-[var(--foreground)]">
          {icon}
          {label}
          <ChevronDownIcon
            className={`w-3.5 h-3.5 transition-transform duration-300 ${open ? '' : '-rotate-90'}`}
          />
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
