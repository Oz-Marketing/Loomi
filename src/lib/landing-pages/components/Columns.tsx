import * as React from 'react';

export interface ColumnsProps {
  columnCount?: number;
  gap?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  children?: React.ReactNode;
}

const ALIGN_MAP: Record<NonNullable<ColumnsProps['verticalAlign']>, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/**
 * Columns — N-column flexbox row. Each direct child renders into its
 * own column. On narrow viewports the row stacks; we expose that via
 * a data attribute so the editor's mobile preview can flip it.
 */
export const ColumnsBlock: React.FC<ColumnsProps> = ({
  columnCount = 2,
  gap = 24,
  verticalAlign = 'top',
  children,
}) => {
  const items = React.Children.toArray(children);
  const visible = items.slice(0, columnCount);
  return (
    <div
      data-lp-columns-row
      style={{
        display: 'flex',
        gap: `${gap}px`,
        alignItems: ALIGN_MAP[verticalAlign],
        flexWrap: 'wrap',
      }}
    >
      {visible.map((child, i) => (
        <div
          key={i}
          className="loomi-lp-column"
          style={{
            flex: '1 1 0',
            minWidth: 0,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
};

export default ColumnsBlock;
