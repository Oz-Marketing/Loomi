import * as React from 'react';
import { Heading as REmailHeading } from '@react-email/components';

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
}

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
}) => {
  const defaultSizes: Record<number, number> = { 1: 32, 2: 26, 3: 22, 4: 18, 5: 16, 6: 14 };
  const size = fontSize ?? defaultSizes[level] ?? 22;

  return (
    <REmailHeading
      as={`h${level}` as 'h1'}
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
    </REmailHeading>
  );
};

export default HeadingBlock;
