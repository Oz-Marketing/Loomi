import * as React from 'react';
import { Section as REmailSection, Row, Column } from '@react-email/components';

export interface ColumnsProps {
  /** Number of columns. 2 or 3. */
  columnCount?: 2 | 3;
  /** Horizontal gap between columns, in pixels. */
  gap?: number;
  /** Vertical alignment of columns: top | middle | bottom */
  valign?: 'top' | 'middle' | 'bottom';

  // Background
  bgColor?: string;
  bgImage?: string;
  bgSize?: 'cover' | 'contain' | 'auto';
  bgPosition?: string;
  bgRepeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
  // Border
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderColor?: string;
  // Border radius
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;
  /** @deprecated use the 4 corner props */
  borderRadius?: number;
  // Padding
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  // Layout
  minHeight?: number;
  /** Stack columns vertically on small screens (default true). */
  stackOnMobile?: boolean;
  children?: React.ReactNode;
}

export const ColumnsBlock: React.FC<ColumnsProps> = ({
  columnCount = 2,
  gap = 16,
  valign = 'top',
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
  paddingTop = 16,
  paddingBottom = 16,
  paddingLeft = 16,
  paddingRight = 16,
  minHeight,
  stackOnMobile = true,
  children,
}) => {
  const cols = React.Children.toArray(children).slice(0, columnCount);
  const half = Math.floor(gap / 2);

  const tl = borderRadiusTopLeft ?? borderRadius ?? 0;
  const tr = borderRadiusTopRight ?? borderRadius ?? 0;
  const br = borderRadiusBottomRight ?? borderRadius ?? 0;
  const bl = borderRadiusBottomLeft ?? borderRadius ?? 0;
  const radius = tl || tr || br || bl ? `${tl}px ${tr}px ${br}px ${bl}px` : undefined;

  const border =
    borderWidth > 0 && borderColor && borderStyle !== 'none'
      ? `${borderWidth}px ${borderStyle} ${borderColor}`
      : undefined;

  const innerStyle: React.CSSProperties = {
    backgroundColor: bgColor || 'transparent',
    backgroundImage: bgImage ? `url('${bgImage}')` : undefined,
    backgroundSize: bgImage ? bgSize : undefined,
    backgroundPosition: bgImage ? bgPosition : undefined,
    backgroundRepeat: bgImage ? bgRepeat : undefined,
    border,
    borderRadius: radius,
    minHeight: minHeight ? `${minHeight}px` : undefined,
    padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
    boxSizing: 'border-box',
  };

  return (
    <REmailSection style={{ margin: 0 }}>
      <div style={innerStyle}>
        <Row style={{ margin: 0 }}>
          {cols.map((col, i) => (
            <Column
              key={i}
              valign={valign}
              className={stackOnMobile ? 'loomi-mobile-stack' : undefined}
              style={{
                verticalAlign: valign,
                paddingLeft: i > 0 ? `${half}px` : 0,
                paddingRight: i < cols.length - 1 ? `${half}px` : 0,
                width: `${100 / columnCount}%`,
              }}
            >
              {col}
            </Column>
          ))}
        </Row>
      </div>
    </REmailSection>
  );
};

export default ColumnsBlock;
