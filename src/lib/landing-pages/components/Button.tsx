import * as React from 'react';

/**
 * Shared button used by Hero, CTA, FeatureGrid, etc. Pulls the
 * primary brand color off the `--loomi-lp-primary` CSS variable that
 * LandingPageRenderer sets at the page root — so per-page brand
 * overrides cascade through every block automatically.
 */
export type ButtonStyle = 'solid' | 'outline' | 'ghost';

export interface ButtonProps {
  label: string;
  href?: string;
  variant?: ButtonStyle;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  href = '#',
  variant = 'solid',
  size = 'md',
  fullWidth = false,
}) => {
  const padY = size === 'lg' ? 14 : 11;
  const padX = size === 'lg' ? 28 : 20;
  const fontSize = size === 'lg' ? 16 : 15;

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${padY}px ${padX}px`,
    borderRadius: 8,
    fontSize,
    fontWeight: 600,
    lineHeight: 1.2,
    textDecoration: 'none',
    transition: 'transform 80ms ease, opacity 120ms ease',
    cursor: 'pointer',
    width: fullWidth ? '100%' : undefined,
    boxSizing: 'border-box',
  };

  const variants: Record<ButtonStyle, React.CSSProperties> = {
    solid: {
      background: 'var(--loomi-lp-primary, #6366f1)',
      color: '#ffffff',
      border: '1px solid transparent',
    },
    outline: {
      background: 'transparent',
      color: 'var(--loomi-lp-primary, #6366f1)',
      border: '1px solid var(--loomi-lp-primary, #6366f1)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--loomi-lp-primary, #6366f1)',
      border: '1px solid transparent',
    },
  };

  return (
    <a href={href} style={{ ...base, ...variants[variant] }}>
      {label}
    </a>
  );
};

export default Button;
