import * as React from 'react';
import { Button } from './Button';

export type HeroLayout = 'centered' | 'left' | 'split-right' | 'split-left';

export interface HeroProps {
  layout?: HeroLayout;
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  imageSrc?: string;
  backgroundColor?: string;
  textColor?: string;
  minHeight?: number;
}

export const HeroBlock: React.FC<HeroProps> = ({
  layout = 'centered',
  eyebrow,
  heading = 'Your big promise, plainly stated.',
  subheading = 'One or two sentences that explain what this page is about and why a visitor should care.',
  primaryCtaLabel = 'Get started',
  primaryCtaHref = '#',
  secondaryCtaLabel,
  secondaryCtaHref,
  imageSrc,
  backgroundColor,
  textColor,
  minHeight = 480,
}) => {
  const isSplit = layout === 'split-right' || layout === 'split-left';
  const align = layout === 'centered' ? 'center' : 'left';

  const wrapperStyle: React.CSSProperties = {
    minHeight: `${minHeight}px`,
    background: backgroundColor || 'transparent',
    color: textColor || undefined,
    padding: '64px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  };

  const inner: React.CSSProperties = {
    width: '100%',
    maxWidth: 1140,
    display: isSplit ? 'flex' : 'block',
    flexDirection: layout === 'split-left' ? 'row-reverse' : 'row',
    alignItems: 'center',
    gap: 48,
  };

  const copy = (
    <div style={{ flex: '1 1 0', textAlign: align, maxWidth: isSplit ? 540 : undefined, margin: layout === 'centered' ? '0 auto' : undefined }}>
      {eyebrow ? (
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.7,
            marginBottom: 16,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(36px, 5vw, 56px)',
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
        }}
      >
        {heading}
      </h1>
      {subheading ? (
        <p
          style={{
            margin: '20px 0 0',
            fontSize: 18,
            lineHeight: 1.55,
            opacity: 0.8,
            maxWidth: 560,
            marginLeft: layout === 'centered' ? 'auto' : 0,
            marginRight: layout === 'centered' ? 'auto' : 0,
          }}
        >
          {subheading}
        </p>
      ) : null}
      <div
        style={{
          marginTop: 32,
          display: 'flex',
          gap: 12,
          justifyContent: layout === 'centered' ? 'center' : 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {primaryCtaLabel ? (
          <Button label={primaryCtaLabel} href={primaryCtaHref} variant="solid" size="lg" />
        ) : null}
        {secondaryCtaLabel ? (
          <Button label={secondaryCtaLabel} href={secondaryCtaHref || '#'} variant="ghost" size="lg" />
        ) : null}
      </div>
    </div>
  );

  const image = imageSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageSrc}
      alt=""
      style={{
        flex: '1 1 0',
        maxWidth: '50%',
        width: '100%',
        height: 'auto',
        borderRadius: 16,
        boxShadow: '0 20px 50px -20px rgba(0,0,0,0.2)',
      }}
    />
  ) : isSplit ? (
    <div
      aria-hidden
      style={{
        flex: '1 1 0',
        aspectRatio: '4 / 3',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))',
        borderRadius: 16,
      }}
    />
  ) : null;

  return (
    <div style={wrapperStyle}>
      <div style={inner}>
        {copy}
        {isSplit ? image : null}
      </div>
    </div>
  );
};

export default HeroBlock;
