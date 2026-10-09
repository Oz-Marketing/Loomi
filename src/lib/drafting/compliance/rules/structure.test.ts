import { describe, expect, it } from 'vitest';
import { DISCLAIMER, blockById, draft } from '../__fixtures__/drafts';
import { copyOptionsRule, disclaimerVerbatimRule, multiCtaRule, unsubscribeRule, UNSUBSCRIBE_TOKENS } from './structure';

describe('footer.unsubscribe', () => {
  it('requires the sender’s unsubscribe link in the footer', async () => {
    const a = await draft((t) => {
      blockById(t, 'footer-text').props.text = 'YoungChev.com';
    });
    expect(unsubscribeRule.check(a)).toMatchObject([{ severity: 'error', where: 'footer' }]);
  });

  it('rejects the other sender’s token, which would unsubscribe nobody', async () => {
    const a = await draft((t) => {
      blockById(t, 'footer-text').props.text = `YoungChev.com · <a href="${UNSUBSCRIBE_TOKENS.loomi}" style="color:#000000">Unsubscribe</a>`;
    });
    const messages = unsubscribeRule.check(a).map((f) => f.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('{{email.unsubscribe_link}}');
    expect(messages[1]).toContain('only works when Loomi sends');
  });

  it('accepts Loomi’s token on a Loomi send', async () => {
    const a = await draft(
      (t) => {
        blockById(t, 'footer-text').props.text = `YoungChev.com · <a href="${UNSUBSCRIBE_TOKENS.loomi}" style="color:#000000">Unsubscribe</a>`;
      },
      { sendTarget: 'loomi' },
    );
    expect(unsubscribeRule.check(a)).toEqual([]);
  });

  it('reports a missing footer block', async () => {
    const a = await draft(undefined, { footerBlockId: 'nope' });
    expect(unsubscribeRule.check(a)[0].message).toContain('"nope"');
  });
});

describe('copy.subject-and-preview-options', () => {
  it('requires an urgent subject line for the follow-up send', async () => {
    const a = await draft(undefined, { subjects: [{ kind: 'initial', text: 'Save $3,500 on the 2026 Equinox ACTIV' }] });
    expect(copyOptionsRule.check(a).map((f) => f.message)).toEqual([
      "There's no urgent subject variation for the follow-up send.",
    ]);
  });

  it('rejects options that are the same line', async () => {
    const a = await draft(undefined, {
      previews: [
        { kind: 'initial', text: 'The offer ends Oct 31.' },
        { kind: 'urgent', text: 'the offer  ends Oct 31.' },
      ],
    });
    expect(copyOptionsRule.check(a)[0].message).toMatch(/previews 1 and 2 are the same line/);
  });
});

describe('disclaimer.verbatim', () => {
  it('rejects a disclaimer that was reworded', async () => {
    const a = await draft((t) => {
      blockById(t, 'disclaimer').props.text = DISCLAIMER.replace('Take delivery by', 'Deliver by');
    });
    const [finding] = disclaimerVerbatimRule.check(a);
    expect(finding.message).toContain('word for word');
    expect(finding.excerpt).toContain('Take delivery by');
  });

  it('tolerates only whitespace differences, which HTML collapses anyway', async () => {
    const a = await draft((t) => {
      blockById(t, 'disclaimer').props.text = DISCLAIMER.replace(/\. /g, '.\n  ');
    });
    expect(disclaimerVerbatimRule.check(a)).toEqual([]);
  });

  it('has nothing to check when the creative carried no disclaimer', async () => {
    expect(disclaimerVerbatimRule.check(await draft(undefined, { disclaimer: null }))).toEqual([]);
  });
});

describe('layout.multi-cta', () => {
  it('rejects CTAs stacked one above another on desktop', async () => {
    const a = await draft((t) => {
      const ctas = blockById(t, 'ctas');
      ctas.type = 'section';
      ctas.props = {};
    });
    expect(multiCtaRule.check(a)).toMatchObject([{ severity: 'error', where: 'block:cta-shop' }]);
  });

  it('requires side-by-side CTAs to stack on mobile, full width', async () => {
    const a = await draft((t) => {
      blockById(t, 'ctas').props.stackOnMobile = false;
      blockById(t, 'cta-trade').props.fullWidth = false;
    });
    expect(multiCtaRule.check(a).map((f) => f.where)).toEqual(['block:ctas', 'block:cta-trade']);
  });

  it('leaves a single CTA alone', async () => {
    const a = await draft((t) => {
      const ctas = blockById(t, 'ctas');
      ctas.children = ctas.children!.slice(0, 1);
      ctas.props.columnCount = 1;
      blockById(t, 'cta-shop').props.fullWidth = false;
    });
    expect(multiCtaRule.check(a)).toEqual([]);
  });
});
