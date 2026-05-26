import * as React from 'react';

/**
 * Section — full-width band with background + padding. Centers an
 * inner container at `maxWidth`. Marketing pages typically stack
 * several Sections vertically (Hero, then features, then CTA, etc.).
 */
export interface SectionProps {
  backgroundColor?: string;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  children?: React.ReactNode;
}

export const SectionBlock: React.FC<SectionProps> = ({
  backgroundColor = 'transparent',
  paddingTop = 64,
  paddingBottom = 64,
  paddingLeft = 24,
  paddingRight = 24,
  maxWidth = 1140,
  align = 'center',
  children,
}) => {
  return (
    <section
      style={{
        backgroundColor,
        paddingTop: `${paddingTop}px`,
        paddingBottom: `${paddingBottom}px`,
        paddingLeft: `${paddingLeft}px`,
        paddingRight: `${paddingRight}px`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: `${maxWidth}px`,
          margin: '0 auto',
          textAlign: align,
        }}
      >
        {children}
      </div>
    </section>
  );
};

export default SectionBlock;
