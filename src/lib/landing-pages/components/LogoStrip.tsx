import * as React from 'react';

export interface LogoStripLogo {
  src: string;
  alt: string;
  href?: string;
}

export interface LogoStripProps {
  heading?: string;
  logos?: LogoStripLogo[];
  grayscale?: boolean;
}

export const LogoStripBlock: React.FC<LogoStripProps> = ({
  heading,
  logos,
  grayscale = true,
}) => {
  const list = logos ?? [];
  return (
    <div>
      {heading ? (
        <div
          style={{
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            opacity: 0.6,
            marginBottom: 24,
          }}
        >
          {heading}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 48,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: grayscale ? 0.7 : 1,
          filter: grayscale ? 'grayscale(1)' : undefined,
        }}
      >
        {list.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>
            Add customer logos in the right panel.
          </div>
        ) : (
          list.map((logo, i) => {
            // eslint-disable-next-line @next/next/no-img-element
            const img = (
              <img
                src={logo.src}
                alt={logo.alt}
                style={{ height: 32, width: 'auto', objectFit: 'contain' }}
              />
            );
            return logo.href ? (
              <a key={i} href={logo.href} style={{ display: 'inline-block' }}>
                {img}
              </a>
            ) : (
              <span key={i} style={{ display: 'inline-block' }}>
                {img}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LogoStripBlock;
