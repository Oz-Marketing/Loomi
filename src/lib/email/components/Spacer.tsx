import * as React from 'react';

export interface SpacerProps {
  height?: number;
  bgColor?: string;
}

export const SpacerBlock: React.FC<SpacerProps> = ({ height = 24, bgColor }) => {
  return (
    <div
      style={{
        height: `${height}px`,
        lineHeight: `${height}px`,
        fontSize: '1px',
        backgroundColor: bgColor || 'transparent',
      }}
      aria-hidden="true"
    >
      &nbsp;
    </div>
  );
};

export default SpacerBlock;
