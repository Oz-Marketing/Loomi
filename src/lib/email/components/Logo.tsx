import * as React from 'react';
import { ImageBlock, type ImageBlockProps } from './Image';

export type LogoProps = Omit<ImageBlockProps, 'maxWidth'> & {
  width?: number;
};

export const LogoBlock: React.FC<LogoProps> = ({ width = 140, align = 'center', ...rest }) => {
  return <ImageBlock {...rest} width={width} maxWidth={width} align={align} />;
};

export default LogoBlock;
