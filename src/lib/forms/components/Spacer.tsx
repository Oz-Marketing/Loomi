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
        backgroundColor: bgColor || 'transparent',
      }}
      aria-hidden="true"
    />
  );
};

export default SpacerBlock;
