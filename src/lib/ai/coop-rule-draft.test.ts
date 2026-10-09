import { describe, it, expect } from 'vitest';
import { buildRulesDraftParams } from './coop-rule-draft';

describe('buildRulesDraftParams', () => {
  // Left unsaid, the model wrote Python regex: `(?i)political|…` reached a pack, and
  // JavaScript can't compile it. Screening now copes; this keeps proposals from
  // needing it.
  it('names the regex dialect and rules out inline flags', () => {
    const params = buildRulesDraftParams({ make: 'Subaru', title: 'SAF 2026', pages: ['Page one.'] });
    const instructions = params.system.map((b) => b.text).join('\n');
    expect(instructions).toContain('JavaScript regular expression');
    expect(instructions).toContain('never add an inline flag such as `(?i)`');
  });
});
