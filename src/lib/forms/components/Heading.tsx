import * as React from 'react';

export interface HeadingProps {
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  color?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  letterSpacing?: number | string;
  lineHeight?: number | string;
  align?: 'left' | 'center' | 'right';
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
}

const DEFAULT_SIZES: Record<number, number> = { 1: 32, 2: 26, 3: 22, 4: 18, 5: 16, 6: 14 };

export const HeadingBlock: React.FC<HeadingProps> = ({
  text = '',
  level = 1,
  color = '#1a1a1a',
  fontSize,
  fontWeight = 700,
  fontFamily,
  letterSpacing,
  lineHeight = 1.2,
  align = 'left',
  marginTop = 0,
  marginRight = 0,
  marginBottom = 16,
  marginLeft = 0,
  textTransform = 'none',
  className,
}) => {
  const Tag = (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
  const size = fontSize ?? DEFAULT_SIZES[level] ?? 22;

  return (
    <Tag
      className={className}
      style={{
        margin: `${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px`,
        color,
        fontSize: `${size}px`,
        fontWeight: String(fontWeight),
        fontFamily: fontFamily || undefined,
        letterSpacing: typeof letterSpacing === 'number' ? `${letterSpacing}px` : letterSpacing,
        lineHeight: String(lineHeight),
        textAlign: align,
        textTransform,
      }}
    >
      {text}
    </Tag>
  );
};

export default HeadingBlock;
