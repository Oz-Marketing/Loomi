import * as React from 'react';
import { Button as REmailButton } from '@react-email/components';

export interface ButtonBlockProps {
  text?: string;
  url?: string;
  bgColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  letterSpacing?: number | string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';

  // Padding — 4 sides (preferred). Falls back to legacy paddingX/paddingY if those exist.
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** @deprecated use paddingLeft / paddingRight */
  paddingX?: number;
  /** @deprecated use paddingTop / paddingBottom */
  paddingY?: number;

  // Border radius — 4 corners (preferred). Falls back to legacy borderRadius.
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;
  /** @deprecated use the 4 corner props */
  borderRadius?: number;

  borderColor?: string;
  borderWidth?: number;
  align?: 'left' | 'center' | 'right';
  fullWidth?: boolean;
}

function pickFirst<T>(...values: (T | undefined)[]): T | undefined {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

export const ButtonBlock: React.FC<ButtonBlockProps> = (props) => {
  const text = props.text ?? 'Click here';
  const url = props.url ?? '#';
  const bgColor = props.bgColor ?? '#1a1a1a';
  const textColor = props.textColor ?? '#ffffff';
  const fontSize = props.fontSize ?? 14;
  const fontWeight = props.fontWeight ?? 600;
  const fontFamily = props.fontFamily;
  const letterSpacing = props.letterSpacing;
  const textTransform = props.textTransform ?? 'none';
  const align = props.align ?? 'left';
  const fullWidth = props.fullWidth ?? false;
  const borderColor = props.borderColor;
  const borderWidth = props.borderWidth ?? 0;

  // Resolve padding from 4-side props, falling back to legacy x/y axis values
  const pTop = pickFirst<number>(props.paddingTop, props.paddingY) ?? 14;
  const pRight = pickFirst<number>(props.paddingRight, props.paddingX) ?? 28;
  const pBottom = pickFirst<number>(props.paddingBottom, props.paddingY) ?? 14;
  const pLeft = pickFirst<number>(props.paddingLeft, props.paddingX) ?? 28;
  const padding = `${pTop}px ${pRight}px ${pBottom}px ${pLeft}px`;

  // Resolve border radius from 4-corner props, falling back to legacy single value
  const rTL = pickFirst<number>(props.borderRadiusTopLeft, props.borderRadius) ?? 4;
  const rTR = pickFirst<number>(props.borderRadiusTopRight, props.borderRadius) ?? 4;
  const rBR = pickFirst<number>(props.borderRadiusBottomRight, props.borderRadius) ?? 4;
  const rBL = pickFirst<number>(props.borderRadiusBottomLeft, props.borderRadius) ?? 4;
  const borderRadius = `${rTL}px ${rTR}px ${rBR}px ${rBL}px`;

  const border = borderWidth > 0 && borderColor ? `${borderWidth}px solid ${borderColor}` : undefined;

  const buttonStyle: React.CSSProperties = {
    backgroundColor: bgColor,
    color: textColor,
    fontSize: `${fontSize}px`,
    fontWeight: String(fontWeight),
    fontFamily: fontFamily || undefined,
    letterSpacing: typeof letterSpacing === 'number' ? `${letterSpacing}px` : letterSpacing,
    textTransform,
    padding,
    borderRadius,
    border,
    display: fullWidth ? 'block' : 'inline-block',
    width: fullWidth ? '100%' : undefined,
    textAlign: 'center',
    textDecoration: 'none',
    lineHeight: 1,
  };

  return (
    <div style={{ textAlign: align }}>
      <REmailButton href={url} style={buttonStyle}>
        {text}
      </REmailButton>
    </div>
  );
};

export default ButtonBlock;
