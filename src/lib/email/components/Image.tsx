import * as React from 'react';
import { Img, Link } from '@react-email/components';

export interface ImageBlockProps {
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  linkUrl?: string;
  align?: 'left' | 'center' | 'right';
  /** @deprecated use the 4 corner props */
  borderRadius?: number;
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;
  /** Optional max-width for responsive sizing */
  maxWidth?: number | string;
}

const PLACEHOLDER =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image%20placeholder.png';

export const ImageBlock: React.FC<ImageBlockProps> = ({
  src,
  alt = '',
  width,
  height,
  linkUrl,
  align = 'center',
  borderRadius = 0,
  borderRadiusTopLeft,
  borderRadiusTopRight,
  borderRadiusBottomRight,
  borderRadiusBottomLeft,
  maxWidth = '100%',
}) => {
  const tl = borderRadiusTopLeft ?? borderRadius;
  const tr = borderRadiusTopRight ?? borderRadius;
  const br = borderRadiusBottomRight ?? borderRadius;
  const bl = borderRadiusBottomLeft ?? borderRadius;
  const radiusValue =
    tl || tr || br || bl ? `${tl}px ${tr}px ${br}px ${bl}px` : undefined;

  const imgStyle: React.CSSProperties = {
    display: 'block',
    border: 0,
    outline: 'none',
    textDecoration: 'none',
    width: '100%',
    maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
    height: 'auto',
    borderRadius: radiusValue,
  };

  const img = (
    <Img
      src={src || PLACEHOLDER}
      alt={alt}
      width={width}
      height={height}
      style={imgStyle}
    />
  );

  const wrapped = linkUrl ? <Link href={linkUrl}>{img}</Link> : img;

  return (
    <div style={{ textAlign: align, lineHeight: 0 }}>
      {wrapped}
    </div>
  );
};

export default ImageBlock;
