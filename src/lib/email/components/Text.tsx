import * as React from 'react';
import { Text as REmailText } from '@react-email/components';

export interface TextProps {
  text?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  align?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  /** When true, renders the text content as raw HTML (allows merge tags + inline tags). */
  allowHtml?: boolean;
}

export const TextBlock: React.FC<TextProps> = ({
  text = '',
  color = '#3a3a3a',
  fontSize = 15,
  fontWeight = 400,
  fontFamily,
  lineHeight = 1.6,
  letterSpacing,
  align = 'left',
  textTransform = 'none',
  marginTop = 0,
  marginRight = 0,
  marginBottom = 16,
  marginLeft = 0,
  allowHtml = false,
}) => {
  const style: React.CSSProperties = {
    margin: `${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px`,
    color,
    fontSize: `${fontSize}px`,
    fontWeight: String(fontWeight),
    fontFamily: fontFamily || undefined,
    lineHeight: String(lineHeight),
    letterSpacing: typeof letterSpacing === 'number' ? `${letterSpacing}px` : letterSpacing,
    textAlign: align,
    textTransform,
  };

  if (allowHtml) {
    return <REmailText style={style} dangerouslySetInnerHTML={{ __html: text }} />;
  }

  return <REmailText style={style}>{text}</REmailText>;
};

export default TextBlock;
