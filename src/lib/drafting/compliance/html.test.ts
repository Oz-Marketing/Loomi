import { describe, expect, it } from 'vitest';
import { anchors, styleDeclarations, visibleText } from './html';

const HTML = `<!DOCTYPE html><html><head><style>.x{color:#ff0000}</style></head><body style="background-color:#eff1f5">
<!--[if mso]><i style="color:#ff0000">x</i><![endif]-->
<a href="https://a.com/?utm_source=email&amp;utm_content=hero" style="color:#067df7"><img src="h.png" alt="Hero"></a>
<p style="color:#000000">Save &amp; <b>drive</b>&nbsp;today</p>
<a href="https://a.com/x" style="color:#067df7">Read more</a>
</body></html>`;

describe('html helpers', () => {
  it('reads visible text without head, styles or comments', () => {
    expect(visibleText(HTML)).toBe('Save & drive today Read more');
  });

  it('decodes link hrefs so they parse as URLs', () => {
    const [hero, more] = anchors(HTML);
    expect(new URL(hero.href).searchParams.get('utm_content')).toBe('hero');
    expect(hero.text).toBe('');
    expect(more).toMatchObject({ index: 2, text: 'Read more' });
  });

  it('drops the color of an image-only link but keeps a text link’s', () => {
    const colors = styleDeclarations(HTML).filter((d) => d.prop === 'color').map((d) => `${d.tag}:${d.value}`);
    expect(colors).toEqual(['p:#000000', 'a:#067df7']);
  });
});
