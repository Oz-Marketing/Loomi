import * as React from 'react';

export interface TextProps {
  text?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  lineHeight?: number;
  color?: string;
}

export const TextBlock: React.FC<TextProps> = ({
  text = 'Add a sentence or two of supporting copy here.',
  align = 'left',
  fontSize = 16,
  lineHeight = 1.6,
  color,
}) => (
  <p
    style={{
      margin: 0,
      fontSize: `${fontSize}px`,
      lineHeight,
      textAlign: align,
      color: color || undefined,
      whiteSpace: 'pre-wrap',
    }}
  >
    {text}
  </p>
);

export default TextBlock;
