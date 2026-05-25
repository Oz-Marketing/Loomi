import * as React from 'react';

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
  maxWidth?: number | string;
}

const PLACEHOLDER =
  'https://loomistorage.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image%20placeholder.png';

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
  const radius = tl || tr || br || bl ? `${tl}px ${tr}px ${br}px ${bl}px` : undefined;

  const img = (
    <img
      src={src || PLACEHOLDER}
      alt={alt}
      width={width}
      height={height}
      style={{
        display: 'inline-block',
        maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
        height: height ? `${height}px` : 'auto',
        borderRadius: radius,
      }}
    />
  );

  return (
    <div style={{ textAlign: align, lineHeight: 0 }}>
      {linkUrl ? (
        <a href={linkUrl} rel="noopener noreferrer">
          {img}
        </a>
      ) : (
        img
      )}
    </div>
  );
};

export default ImageBlock;
