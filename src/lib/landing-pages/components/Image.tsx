import * as React from 'react';

export interface ImageProps {
  src?: string;
  alt?: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  borderRadius?: number;
  href?: string;
}

const ALIGN_MAP: Record<NonNullable<ImageProps['align']>, React.CSSProperties> = {
  left: { marginLeft: 0, marginRight: 'auto' },
  center: { marginLeft: 'auto', marginRight: 'auto' },
  right: { marginLeft: 'auto', marginRight: 0 },
};

export const ImageBlock: React.FC<ImageProps> = ({
  src,
  alt = '',
  width = 800,
  align = 'center',
  borderRadius = 8,
  href,
}) => {
  if (!src) {
    return (
      <div
        style={{
          ...ALIGN_MAP[align],
          width: '100%',
          maxWidth: `${width}px`,
          aspectRatio: '16 / 9',
          background: '#f3f4f6',
          color: '#9ca3af',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          borderRadius,
        }}
      >
        No image
      </div>
    );
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={{
        display: 'block',
        width: '100%',
        maxWidth: `${width}px`,
        height: 'auto',
        borderRadius,
        ...ALIGN_MAP[align],
      }}
    />
  );
  return href ? (
    <a href={href} style={{ display: 'block', textDecoration: 'none' }}>
      {img}
    </a>
  ) : (
    img
  );
};

export default ImageBlock;
