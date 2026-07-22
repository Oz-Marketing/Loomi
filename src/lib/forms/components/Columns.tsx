import * as React from 'react';

export interface ColumnsProps {
  columnCount?: 2 | 3;
  gap?: number;
  valign?: 'top' | 'middle' | 'bottom';
  bgColor?: string;
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
  /** Stack columns vertically on small screens (default true). */
  stackOnMobile?: boolean;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
  children?: React.ReactNode;
}

// Columns — flexbox grid. On mobile, optionally stacks via the
// loomi-form-stack class wired up by the public renderer's stylesheet.
export const ColumnsBlock: React.FC<ColumnsProps> = ({
  columnCount = 2,
  gap = 16,
  valign = 'top',
  bgColor,
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
  stackOnMobile = true,
  className,
  children,
}) => {
  const cols = React.Children.toArray(children).slice(0, columnCount);

  const tl = borderRadiusTopLeft ?? borderRadius ?? 0;
  const tr = borderRadiusTopRight ?? borderRadius ?? 0;
  const br = borderRadiusBottomRight ?? borderRadius ?? 0;
  const bl = borderRadiusBottomLeft ?? borderRadius ?? 0;
  const radius = tl || tr || br || bl ? `${tl}px ${tr}px ${br}px ${bl}px` : undefined;
  const border =
    borderWidth > 0 && borderColor && borderStyle !== 'none'
      ? `${borderWidth}px ${borderStyle} ${borderColor}`
      : undefined;

  const alignItems =
    valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      // Marks the flex row so the responsive stylesheets (editor mobile
      // preview + public /f layout) can flip it to a column on narrow
      // viewports. Gated on stackOnMobile so it switches together with
      // the child `loomi-form-stack` class below — when stacking is off,
      // neither the row-flip nor the full-width children kick in.
      data-form-columns-row={stackOnMobile ? '' : undefined}
      className={className}
      style={{
        backgroundColor: bgColor || 'transparent',
        border,
        borderRadius: radius,
        padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        gap: `${gap}px`,
        alignItems,
      }}
    >
      {cols.map((col, i) => (
        <div
          key={i}
          className={stackOnMobile ? 'loomi-form-stack' : undefined}
          style={{ flex: '1 1 0', minWidth: 0 }}
        >
          {col}
        </div>
      ))}
    </div>
  );
};

export default ColumnsBlock;
