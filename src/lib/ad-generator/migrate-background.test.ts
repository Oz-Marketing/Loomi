import { describe, it, expect } from 'vitest';
import { migrateDocBackground } from './migrate-background';
import { renderDoc } from './doc-renderer';
import type { TemplateDoc } from './doc-types';
import type { AdSize } from './types';

const SIZE: AdSize = { id: 'square', label: 'Square', width: 1000, height: 1000 };

function base(background: TemplateDoc['background']): TemplateDoc {
  return { id: 't', name: 'T', sizes: [SIZE], fields: [], background, elements: [], layouts: { square: {} }, defaults: {} };
}

describe('migrateDocBackground', () => {
  it('converts a solid canvas color into a full-bleed background element', () => {
    const { doc, changed } = migrateDocBackground(base({ color: '#199fdb' }));
    expect(changed).toBe(true);
    const el = doc.elements.find((e) => e.id === 'background-migrated');
    expect(el?.fill).toBe('#199fdb');
    expect(doc.layouts.square[el!.id]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(doc.background).toBeUndefined();
  });

  it('converts a legacy two-stop gradient into the element gradientFill', () => {
    const { doc } = migrateDocBackground(base({ gradient: ['#fff', '#000'], gradientAngle: 90, gradientStops: [10, 80] }));
    const el = doc.elements.find((e) => e.id === 'background-migrated')!;
    expect(el.gradientFill).toEqual({ type: 'linear', angle: 90, stops: [{ color: '#fff', pos: 10 }, { color: '#000', pos: 80 }] });
  });

  it('carries a new gradientFill straight onto the element', () => {
    const gf = { type: 'radial' as const, stops: [{ color: '#111', pos: 0 }, { color: '#222', pos: 100 }] };
    const { doc } = migrateDocBackground(base({ gradientFill: gf }));
    expect(doc.elements.find((e) => e.id === 'background-migrated')!.gradientFill).toEqual(gf);
  });

  it('preserves accentBar on doc.background but drops the fill', () => {
    const { doc } = migrateDocBackground(base({ color: '#123456', accentBar: true }));
    expect(doc.background).toEqual({ accentBar: true });
    expect(doc.elements.find((e) => e.id === 'background-migrated')!.fill).toBe('#123456');
  });

  it('is idempotent — a doc that already has a background element is unchanged', () => {
    const once = migrateDocBackground(base({ color: '#199fdb' })).doc;
    const twice = migrateDocBackground(once);
    expect(twice.changed).toBe(false);
    expect(twice.doc.elements.filter((e) => e.id === 'background-migrated')).toHaveLength(1);
  });

  it('leaves a doc without a background fill unchanged', () => {
    expect(migrateDocBackground(base(undefined)).changed).toBe(false);
    expect(migrateDocBackground(base({ accentBar: true })).changed).toBe(false);
  });

  it('renders the same fill CSS before (canvas) and after (element)', () => {
    const before = base({ gradient: ['#ffffff', '#eeeeee'] });
    const beforeHtml = renderDoc(before, {}, SIZE);
    expect(beforeHtml).toContain('linear-gradient(135deg, #ffffff 0%, #eeeeee 100%)');
    const afterHtml = renderDoc(migrateDocBackground(before).doc, {}, SIZE);
    expect(afterHtml).toContain('linear-gradient(135deg, #ffffff 0%, #eeeeee 100%)');
  });
});
