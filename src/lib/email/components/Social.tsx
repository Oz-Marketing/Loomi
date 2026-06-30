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

// Map our platform keys to Icons8 icon slugs.
const ICON_SLUGS: Record<string, string> = {
  facebook: 'facebook-new',
  instagram: 'instagram-new',
  twitter: 'twitterx',
  x: 'twitterx',
  youtube: 'youtube-play',
  linkedin: 'linkedin',
  tiktok: 'tiktok',
};

/**
 * Build an email-safe PNG icon URL from Icons8's static CDN. The colour is
 * baked into the URL, so each variant is genuinely distinct:
 *   - color      → full-colour brand icon
 *   - mono-light → solid white glyph
 *   - mono-dark  → solid black glyph
 * (The previous hand-picked flaticon IDs reused the same colour icon across
 * variants for twitter/tiktok/linkedin, so those never switched to B/W.)
 */
function iconUrl(platform: string, variant: NonNullable<SocialProps['variant']>): string {
  const slug = ICON_SLUGS[platform.toLowerCase()] ?? ICON_SLUGS.facebook;
  if (variant === 'mono-light') return `https://img.icons8.com/ios-filled/96/FFFFFF/${slug}.png`;
  if (variant === 'mono-dark') return `https://img.icons8.com/ios-filled/96/000000/${slug}.png`;
  return `https://img.icons8.com/color/96/${slug}.png`;
}

/**
 * Resolve the link list from either the flat `link{n}-platform` /
 * `link{n}-url` props the editor panel writes, or a `links[]` array.
 *
 * Flat props win when present: the V2 properties panel edits the block via
 * the flat schema (component-schemas.ts) even though a freshly-created block
 * is seeded with a `links[]` array, so preferring flat keeps the canvas in
 * sync with what the user is actually editing. Entries without a URL are
 * dropped so empty seed rows don't render stray icons. Keeping this inside
 * the component means every render path — live canvas, compiled email,
 * anywhere BLOCK_COMPONENTS is used — behaves identically.
 */
function resolveLinks(props: SocialProps & Record<string, unknown>): SocialLink[] {
  const flat: SocialLink[] = [];
  for (let n = 1; n <= 6; n++) {
    const url = props[`link${n}-url`];
    if (typeof url !== 'string' || !url.trim()) continue;
    const platform = props[`link${n}-platform`];
    flat.push({
      platform: typeof platform === 'string' && platform ? platform : 'facebook',
      url: url.trim(),
    });
  }
  if (flat.length) return flat;

  if (Array.isArray(props.links)) {
    return props.links.filter(
      (l): l is SocialLink => Boolean(l && typeof l.url === 'string' && l.url.trim()),
    );
  }
  return [];
}

export const SocialBlock: React.FC<SocialProps & Record<string, unknown>> = (props) => {
  const {
    iconSize = 28,
    spacing = 8,
    align = 'center',
    variant = 'color',
  } = props;
  const links = resolveLinks(props);
  if (!links.length) return null;

  return (
    <Section style={{ textAlign: align }}>
      <Row>
        <Column align={align}>
          {links.map((link, i) => {
            const icon = link.iconUrl || iconUrl(link.platform, variant);
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
