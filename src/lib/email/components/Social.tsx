import * as React from 'react';
import { Img, Link, Section, Row, Column } from '@react-email/components';

export interface SocialLink {
  platform: string;        // 'facebook' | 'instagram' | 'twitter' | 'youtube' | 'linkedin' | 'tiktok' | custom
  url: string;
  iconUrl?: string;        // override default icon
  label?: string;
}

export interface SocialProps {
  links?: SocialLink[];
  iconSize?: number;
  spacing?: number;
  align?: 'left' | 'center' | 'right';
  /** Visual treatment: filled (white icon on colored bg), outline (icon-only), color (brand-colored) */
  variant?: 'color' | 'mono-light' | 'mono-dark';
}

const DEFAULT_ICONS: Record<SocialProps['variant'] & string, Record<string, string>> = {
  color: {
    facebook: 'https://cdn-icons-png.flaticon.com/512/124/124010.png',
    instagram: 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png',
    twitter: 'https://cdn-icons-png.flaticon.com/512/733/733579.png',
    youtube: 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png',
    linkedin: 'https://cdn-icons-png.flaticon.com/512/174/174857.png',
    tiktok: 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png',
  },
  'mono-light': {
    facebook: 'https://cdn-icons-png.flaticon.com/512/733/733547.png',
    instagram: 'https://cdn-icons-png.flaticon.com/512/733/733558.png',
    twitter: 'https://cdn-icons-png.flaticon.com/512/733/733579.png',
    youtube: 'https://cdn-icons-png.flaticon.com/512/733/733646.png',
    linkedin: 'https://cdn-icons-png.flaticon.com/512/733/733561.png',
    tiktok: 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png',
  },
  'mono-dark': {
    facebook: 'https://cdn-icons-png.flaticon.com/512/0/747.png',
    instagram: 'https://cdn-icons-png.flaticon.com/512/87/87390.png',
    twitter: 'https://cdn-icons-png.flaticon.com/512/733/733579.png',
    youtube: 'https://cdn-icons-png.flaticon.com/512/2111/2111748.png',
    linkedin: 'https://cdn-icons-png.flaticon.com/512/174/174857.png',
    tiktok: 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png',
  },
};

export const SocialBlock: React.FC<SocialProps> = ({
  links = [],
  iconSize = 28,
  spacing = 8,
  align = 'center',
  variant = 'color',
}) => {
  if (!links.length) return null;

  const iconMap = DEFAULT_ICONS[variant] || DEFAULT_ICONS.color;

  return (
    <Section style={{ textAlign: align }}>
      <Row>
        <Column align={align}>
          {links.map((link, i) => {
            const icon = link.iconUrl || iconMap[link.platform.toLowerCase()] || iconMap.facebook;
            return (
              <Link
                key={i}
                href={link.url}
                style={{
                  display: 'inline-block',
                  marginRight: i < links.length - 1 ? `${spacing}px` : 0,
                  textDecoration: 'none',
                }}
              >
                <Img
                  src={icon}
                  alt={link.label || link.platform}
                  width={iconSize}
                  height={iconSize}
                  style={{
                    display: 'inline-block',
                    border: 0,
                    width: `${iconSize}px`,
                    height: `${iconSize}px`,
                  }}
                />
              </Link>
            );
          })}
        </Column>
      </Row>
    </Section>
  );
};

export default SocialBlock;
