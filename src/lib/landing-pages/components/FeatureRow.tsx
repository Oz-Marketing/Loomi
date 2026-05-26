import * as React from 'react';

export interface FeatureRowProps {
  layout?: 'icon-top' | 'icon-left';
  iconSrc?: string;
  heading?: string;
  body?: string;
  align?: 'left' | 'center' | 'right';
}

export const FeatureRowBlock: React.FC<FeatureRowProps> = ({
  layout = 'icon-top',
  iconSrc,
  heading = 'A feature worth highlighting',
  body = 'Explain the benefit in one or two sentences.',
  align = 'left',
}) => {
  const icon = iconSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconSrc}
      alt=""
      style={{
        width: 48,
        height: 48,
        objectFit: 'contain',
        flexShrink: 0,
      }}
    />
  ) : (
    <div
      aria-hidden
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: 'rgba(99,102,241,0.12)',
        flexShrink: 0,
      }}
    />
  );

  const copy = (
    <div style={{ textAlign: layout === 'icon-top' ? align : 'left' }}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{heading}</h3>
      <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.55, opacity: 0.8 }}>{body}</p>
    </div>
  );

  if (layout === 'icon-left') {
    return (
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {icon}
        {copy}
      </div>
    );
  }

  return (
    <div style={{ textAlign: align }}>
      <div style={{ marginBottom: 16, display: 'inline-block' }}>{icon}</div>
      {copy}
    </div>
  );
};

export default FeatureRowBlock;
