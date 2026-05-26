import * as React from 'react';

export interface VideoProps {
  url?: string;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16';
  autoplay?: boolean;
}

const ASPECT: Record<NonNullable<VideoProps['aspectRatio']>, string> = {
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '1:1': '1 / 1',
  '9:16': '9 / 16',
};

/**
 * Parse a YouTube/Vimeo URL into an embed URL. Returns null for
 * unknown providers; callers fall back to a placeholder.
 */
function toEmbedUrl(url: string, autoplay: boolean): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    // YouTube — handles both youtu.be/<id> and youtube.com/watch?v=<id>
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      if (!id) return null;
      const params = autoplay ? '?autoplay=1&mute=1' : '';
      return `https://www.youtube.com/embed/${id}${params}`;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v');
      if (!id) return null;
      const params = autoplay ? '?autoplay=1&mute=1' : '';
      return `https://www.youtube.com/embed/${id}${params}`;
    }
    // Vimeo — vimeo.com/<id>
    if (host === 'vimeo.com') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (!id || !/^\d+$/.test(id)) return null;
      const params = autoplay ? '?autoplay=1&muted=1' : '';
      return `https://player.vimeo.com/video/${id}${params}`;
    }
    return null;
  } catch {
    return null;
  }
}

export const VideoBlock: React.FC<VideoProps> = ({
  url,
  aspectRatio = '16:9',
  autoplay = false,
}) => {
  const embed = url ? toEmbedUrl(url, autoplay) : null;
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: ASPECT[aspectRatio],
        background: '#000',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {embed ? (
        <iframe
          src={embed}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            fontSize: 13,
          }}
        >
          {url ? 'Unsupported video URL' : 'Paste a YouTube or Vimeo URL'}
        </div>
      )}
    </div>
  );
};

export default VideoBlock;
