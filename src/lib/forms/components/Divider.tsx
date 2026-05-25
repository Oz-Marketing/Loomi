import * as React from 'react';

export interface DividerProps {
  color?: string;
  thickness?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  marginTop?: number;
  marginBottom?: number;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export const DividerBlock: React.FC<DividerProps> = ({
  color = '#e5e5e5',
  thickness = 1,
  style = 'solid',
  marginTop = 16,
  marginBottom = 16,
  width = '100%',
  align = 'center',
}) => {
  const widthValue = typeof width === 'number' ? `${width}px` : width;
  const marginLeft = align === 'left' ? 0 : align === 'right' ? 'auto' : 'auto';
  const marginRight = align === 'right' ? 0 : align === 'left' ? 'auto' : 'auto';

  return (
    <hr
      style={{
        border: 0,
        borderTop: `${thickness}px ${style} ${color}`,
        marginTop: `${marginTop}px`,
        marginBottom: `${marginBottom}px`,
        marginLeft,
        marginRight,
        width: widthValue,
      }}
    />
  );
};

export default DividerBlock;
