import * as React from 'react';

export interface DividerProps {
  color?: string;
  thickness?: number;
  marginY?: number;
}

export const DividerBlock: React.FC<DividerProps> = ({
  color = '#e5e7eb',
  thickness = 1,
  marginY = 24,
}) => (
  <hr
    style={{
      border: 0,
      borderTop: `${thickness}px solid ${color}`,
      margin: `${marginY}px 0`,
    }}
  />
);

export default DividerBlock;
