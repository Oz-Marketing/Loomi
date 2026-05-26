import * as React from 'react';

export interface HeadingProps {
  text?: string;
  level?: 1 | 2 | 3 | 4;
  align?: 'left' | 'center' | 'right';
  fontWeight?: number;
  color?: string;
}

const SIZE_BY_LEVEL: Record<NonNullable<HeadingProps['level']>, number> = {
  1: 48,
  2: 36,
  3: 24,
  4: 18,
};

export const HeadingBlock: React.FC<HeadingProps> = ({
  text = 'A great headline',
  level = 2,
  align = 'left',
  fontWeight = 700,
  color,
}) => {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
  return (
    <Tag
      style={{
        margin: 0,
        fontSize: `${SIZE_BY_LEVEL[level]}px`,
        lineHeight: 1.15,
        fontWeight,
        textAlign: align,
        color: color || undefined,
        letterSpacing: level === 1 ? '-0.02em' : '-0.01em',
      }}
    >
      {text}
    </Tag>
  );
};

export default HeadingBlock;
