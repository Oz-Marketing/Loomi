// Pure mergetag substitution for flow email/SMS bodies. No Prisma / IO so
// it's unit-testable in isolation. The context is built (with DB-loaded
// contact fields) in services/loomi-flows.ts `mergetagCtx`.

const FLOW_MERGETAG_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

// Open-ended so templates can reference built-ins (firstName, …), the
// vehicle columns, AND any of the account's custom fields by key. Keys
// absent from the dict are left intact by applyMergetags.
export type MergetagContext = Record<string, string>;

/** Substitute `{{key}}` placeholders against a known-key dict. Unknown
 *  keys are left intact so the user can spot typos in the rendered
 *  output instead of having values silently disappear. */
export function applyMergetags(input: string, ctx: MergetagContext): string {
  if (!input) return '';
  return input.replace(FLOW_MERGETAG_PATTERN, (match, rawKey: string) => {
    const value = ctx[rawKey];
    return value == null ? match : value;
  });
}
