import * as React from 'react';
import { Button, type ButtonStyle } from './Button';

export interface CtaProps {
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  buttonStyle?: ButtonStyle;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  textColor?: string;
}

export const CtaBlock: React.FC<CtaProps> = ({
  heading = 'Ready to get started?',
  body = 'Sign up in under a minute. No credit card required.',
  ctaLabel = 'Get started',
  ctaHref = '#',
  buttonStyle = 'solid',
  align = 'center',
  backgroundColor,
  textColor,
}) => (
  <div
    style={{
      padding: '48px 32px',
      background: backgroundColor || 'rgba(99,102,241,0.06)',
      color: textColor || undefined,
      borderRadius: 16,
      textAlign: align,
    }}
  >
    <h2
      style={{
        margin: 0,
        fontSize: 32,
        fontWeight: 800,
        letterSpacing: '-0.01em',
      }}
    >
      {heading}
    </h2>
    {body ? (
      <p
        style={{
          margin: '12px auto 0',
          fontSize: 17,
          lineHeight: 1.55,
          opacity: 0.8,
          maxWidth: 560,
        }}
      >
        {body}
      </p>
    ) : null}
    {ctaLabel ? (
      <div style={{ marginTop: 28 }}>
        <Button label={ctaLabel} href={ctaHref} variant={buttonStyle} size="lg" />
      </div>
    ) : null}
  </div>
);

export default CtaBlock;
