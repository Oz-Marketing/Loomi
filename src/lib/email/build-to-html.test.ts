import { describe, it, expect } from 'vitest';
import {
  templateBuildToEmailTemplate,
  renderTemplateBuild,
  type TemplateBuild,
} from './build-to-html';

const visualBuild: TemplateBuild = {
  mode: 'visual',
  components: [
    { type: 'section', props: { bgColor: '#1a1a2e', paddingTop: '48', paddingBottom: '48' } },
    { type: 'heading', props: { text: 'Memorial Day Sale', level: '1', color: '#ffffff' } },
    { type: 'text', props: { text: 'Save big this weekend only.' } },
    { type: 'button', props: { text: 'Shop Now', url: 'https://example.com/sale' } },
  ],
  frontmatter: { subject: 'From build', previewText: 'From build preview' },
};

describe('templateBuildToEmailTemplate', () => {
  it('maps visual components to v2 blocks and merges schema defaults', () => {
    const tpl = templateBuildToEmailTemplate(visualBuild, {
      subject: 'Override subject',
      previewText: 'Override preview',
    });
    expect(tpl).not.toBeNull();
    expect(tpl!.version).toBe('2');
    // explicit opts win over build.frontmatter
    expect(tpl!.subject).toBe('Override subject');
    expect(tpl!.preheader).toBe('Override preview');
    expect(tpl!.blocks).toHaveLength(4);
    expect(tpl!.blocks.map((b) => b.type)).toEqual(['section', 'heading', 'text', 'button']);
    // schema default merged in (heading fontSize default '32' coerced to number 32)
    const heading = tpl!.blocks[1];
    expect(heading.props.text).toBe('Memorial Day Sale');
    expect(heading.props.fontWeight).toBe(700);
  });

  it('falls back to build.frontmatter when opts omit subject/preview', () => {
    const tpl = templateBuildToEmailTemplate(visualBuild);
    expect(tpl!.subject).toBe('From build');
    expect(tpl!.preheader).toBe('From build preview');
  });

  it('returns null for code-mode or empty visual builds', () => {
    expect(templateBuildToEmailTemplate({ mode: 'code', html: '<p>hi</p>' })).toBeNull();
    expect(templateBuildToEmailTemplate({ mode: 'visual', components: [] })).toBeNull();
  });
});

describe('renderTemplateBuild', () => {
  it('renders visual builds to HTML + plain text and returns the v2 template', async () => {
    const out = await renderTemplateBuild(visualBuild, { subject: 'Hi', previewText: 'Preview' });
    expect(out.html).toContain('Memorial Day Sale');
    expect(out.html).toContain('Shop Now');
    expect(out.html.toLowerCase()).toContain('<html');
    // react-email's plain-text renderer uppercases <h1>; match loosely.
    expect(out.textContent.toLowerCase()).toContain('memorial day sale');
    expect(out.template).not.toBeNull();
    expect(out.template!.blocks).toHaveLength(4);
  });

  it('passes through code-mode HTML untouched', async () => {
    const html = '<html><body><h1>Raw</h1></body></html>';
    const out = await renderTemplateBuild({ mode: 'code', html });
    expect(out.html).toBe(html);
    expect(out.template).toBeNull();
  });

  it('throws when a visual build has no renderable blocks', async () => {
    await expect(renderTemplateBuild({ mode: 'visual', components: [] })).rejects.toThrow();
  });

  it('throws when a code build has no HTML', async () => {
    await expect(renderTemplateBuild({ mode: 'code', html: '   ' })).rejects.toThrow();
  });
});

// Regression: the assistant nests content inside sections/columns as children.
// Dropping children left only empty colored bands — these guard that fix.
const nestedBuild: TemplateBuild = {
  mode: 'visual',
  components: [
    {
      type: 'section',
      props: { bgColor: '#c0392b', paddingTop: '40', paddingBottom: '40' },
      children: [
        { type: 'heading', props: { text: 'Big Sale', color: '#ffffff' } },
        { type: 'text', props: { text: 'Save this weekend only.' } },
      ],
    },
    {
      type: 'columns',
      props: { columnCount: '3' },
      children: [
        { type: 'section', props: {}, children: [{ type: 'heading', props: { text: 'One Year Gas' } }] },
        { type: 'section', props: {}, children: [{ type: 'heading', props: { text: 'Two Years Maintenance' } }] },
        { type: 'section', props: {}, children: [{ type: 'heading', props: { text: 'Three Months Free' } }] },
      ],
    },
  ],
};

describe('nested children (sections + columns)', () => {
  it('preserves nested children when mapping to v2 blocks', () => {
    const tpl = templateBuildToEmailTemplate(nestedBuild);
    expect(tpl).not.toBeNull();
    expect(tpl!.blocks).toHaveLength(2);
    expect(tpl!.blocks[0].children).toHaveLength(2); // heading + text inside the section
    expect(tpl!.blocks[1].type).toBe('columns');
    expect(tpl!.blocks[1].children).toHaveLength(3); // 3 column sub-sections
    expect(tpl!.blocks[1].children![0].children).toHaveLength(1); // heading inside a column
  });

  it('renders the nested content (not just empty containers)', async () => {
    const out = await renderTemplateBuild(nestedBuild, { subject: 'Sale' });
    for (const text of ['Big Sale', 'Save this weekend only.', 'One Year Gas', 'Two Years Maintenance', 'Three Months Free']) {
      expect(out.html).toContain(text);
    }
  });
});
