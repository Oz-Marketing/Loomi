import * as React from 'react';

export interface SpacerProps {
  height?: number;
  bgColor?: string;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
}

export const SpacerBlock: React.FC<SpacerProps> = ({ height = 24, bgColor, className }) => {
  return (
    <div
      className={className}
      style={{
        height: `${height}px`,
        backgroundColor: bgColor || 'transparent',
      }}
      aria-hidden="true"
    />
  );
};

export default SpacerBlock;
