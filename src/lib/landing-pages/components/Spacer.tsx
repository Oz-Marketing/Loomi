import * as React from 'react';

export const SpacerBlock: React.FC<{ height?: number }> = ({ height = 48 }) => (
  <div aria-hidden style={{ height: `${height}px` }} />
);

export default SpacerBlock;
