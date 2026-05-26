import * as React from 'react';

export interface TestimonialProps {
  quote?: string;
  authorName?: string;
  authorRole?: string;
  avatarSrc?: string;
  align?: 'left' | 'center' | 'right';
}

export const TestimonialBlock: React.FC<TestimonialProps> = ({
  quote = '"This is exactly what we were looking for."',
  authorName = 'Jane Doe',
  authorRole = 'Marketing Director, Acme Co',
  avatarSrc,
  align = 'center',
}) => (
  <blockquote
    style={{
      margin: 0,
      padding: '32px 24px',
      maxWidth: 720,
      marginLeft: align === 'left' ? 0 : align === 'right' ? 'auto' : 'auto',
      marginRight: align === 'right' ? 0 : align === 'left' ? 'auto' : 'auto',
      textAlign: align,
    }}
  >
    <p
      style={{
        margin: 0,
        fontSize: 22,
        lineHeight: 1.4,
        fontWeight: 500,
        letterSpacing: '-0.01em',
      }}
    >
      {quote}
    </p>
    <footer
      style={{
        marginTop: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {avatarSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarSrc}
          alt=""
          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.08)',
          }}
        />
      )}
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{authorName}</div>
        {authorRole ? (
          <div style={{ fontSize: 13, opacity: 0.7 }}>{authorRole}</div>
        ) : null}
      </div>
    </footer>
  </blockquote>
);

export default TestimonialBlock;
