import * as React from 'react';

export interface FeatureGridItem {
  heading: string;
  body: string;
  iconSrc?: string;
}

export interface FeatureGridProps {
  columns?: number;
  heading?: string;
  subheading?: string;
  items?: FeatureGridItem[];
}

const DEFAULT_ITEMS: FeatureGridItem[] = [
  { heading: 'Fast', body: 'Built for speed and clarity.' },
  { heading: 'Flexible', body: 'Drop into any page in seconds.' },
  { heading: 'Trusted', body: 'Used by teams who care about polish.' },
];

export const FeatureGridBlock: React.FC<FeatureGridProps> = ({
  columns = 3,
  heading,
  subheading,
  items,
}) => {
  const cells = items?.length ? items : DEFAULT_ITEMS;
  const clampedCols = Math.max(2, Math.min(4, columns));
  return (
    <div>
      {heading ? (
        <div style={{ textAlign: 'center', marginBottom: subheading ? 12 : 48 }}>
          <h2 style={{ margin: 0, fontSize: 36, fontWeight: 800, letterSpacing: '-0.01em' }}>
            {heading}
          </h2>
        </div>
      ) : null}
      {subheading ? (
        <p
          style={{
            textAlign: 'center',
            maxWidth: 640,
            margin: '0 auto 48px',
            fontSize: 17,
            lineHeight: 1.55,
            opacity: 0.75,
          }}
        >
          {subheading}
        </p>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${clampedCols}, minmax(0, 1fr))`,
          gap: 32,
        }}
      >
        {cells.map((cell, i) => (
          <div key={i}>
            {cell.iconSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cell.iconSrc}
                alt=""
                style={{ width: 40, height: 40, objectFit: 'contain', marginBottom: 14 }}
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(99,102,241,0.12)',
                  marginBottom: 14,
                }}
              />
            )}
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{cell.heading}</h3>
            <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.55, opacity: 0.8 }}>
              {cell.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeatureGridBlock;
