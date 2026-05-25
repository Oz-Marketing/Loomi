import * as React from 'react';

// Section — a container with bg/border/padding around its children. Plain
// browser HTML; forms render in the browser (not in an email client) so we
// don't need react-email's table-based scaffolding.
export interface SectionProps {
  bgColor?: string;
  bgImage?: string;
  bgSize?: 'cover' | 'contain' | 'auto';
  bgPosition?: string;
  bgRepeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderColor?: string;
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;
  /** @deprecated use the 4 corner props */
  borderRadius?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  align?: 'left' | 'center' | 'right';
  gap?: number;
  minHeight?: number;
  children?: React.ReactNode;
}

export const SectionBlock: React.FC<SectionProps> = ({
  bgColor,
  bgImage,
  bgSize = 'cover',
  bgPosition = 'center center',
  bgRepeat = 'no-repeat',
  borderWidth = 0,
  borderStyle = 'solid',
  borderColor,
  borderRadius,
  borderRadiusTopLeft,
  borderRadiusTopRight,
  borderRadiusBottomRight,
  borderRadiusBottomLeft,
  paddingTop = 24,
  paddingBottom = 24,
  paddingLeft = 32,
  paddingRight = 32,
  align = 'left',
  gap = 0,
  minHeight,
  children,
}) => {
  const tl = borderRadiusTopLeft ?? borderRadius ?? 0;
  const tr = borderRadiusTopRight ?? borderRadius ?? 0;
  const br = borderRadiusBottomRight ?? borderRadius ?? 0;
  const bl = borderRadiusBottomLeft ?? borderRadius ?? 0;
  const radius = tl || tr || br || bl ? `${tl}px ${tr}px ${br}px ${bl}px` : undefined;

  const border =
    borderWidth > 0 && borderColor && borderStyle !== 'none'
      ? `${borderWidth}px ${borderStyle} ${borderColor}`
      : undefined;

  const style: React.CSSProperties = {
    backgroundColor: bgColor || 'transparent',
    backgroundImage: bgImage ? `url('${bgImage}')` : undefined,
    backgroundSize: bgImage ? bgSize : undefined,
    backgroundPosition: bgImage ? bgPosition : undefined,
    backgroundRepeat: bgImage ? bgRepeat : undefined,
    border,
    borderRadius: radius,
    minHeight: minHeight ? `${minHeight}px` : undefined,
    padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
    textAlign: align,
    boxSizing: 'border-box',
    ...(gap > 0
      ? { display: 'flex', flexDirection: 'column', rowGap: `${gap}px` }
      : null),
  };

  return <div style={style}>{children}</div>;
};

export default SectionBlock;
