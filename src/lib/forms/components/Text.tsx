import * as React from 'react';
import { sanitizeInlineHtml } from '../sanitize-inline';

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
  /** When true, renders the text content as raw HTML (allows inline tags + merge tags). */
  allowHtml?: boolean;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
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
  className,
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
    // Sanitize before injecting — allows links + inline formatting while
    // stripping scripts/handlers on the public /f page.
    return <p className={className} style={style} dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(text) }} />;
  }
  return <p className={className} style={style}>{text}</p>;
};

export default TextBlock;
