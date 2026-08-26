'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center gap-2 h-10 px-4 text-sm font-medium rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-[var(--primary-foreground)] hover:bg-[var(--primary)] transition-colors disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

PrimaryButton.displayName = 'PrimaryButton';

export default PrimaryButton;
