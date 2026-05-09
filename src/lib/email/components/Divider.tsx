import * as React from 'react';
import { Hr } from '@react-email/components';

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
  const marginX =
    align === 'left' ? '0 auto 0 0' : align === 'right' ? '0 0 0 auto' : 'auto';

  return (
    <Hr
      style={{
        border: 0,
        borderTop: `${thickness}px ${style} ${color}`,
        margin: `${marginTop}px ${marginX === 'auto' ? 'auto' : ''} ${marginBottom}px ${marginX === 'auto' ? 'auto' : ''}`.replace(/\s+/g, ' ').trim() || `${marginTop}px auto ${marginBottom}px`,
        width: widthValue,
      }}
    />
  );
};

export default DividerBlock;
