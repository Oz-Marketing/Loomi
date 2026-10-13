/**
 * The designs a run may actually build, from a config's own columns.
 *
 * Unions the recommended design into the permitted set: a config that names a
 * lead outside its own fan-out list would recommend a design the run then
 * refuses to build, and the dealer's row would lead with nothing. Empty result
 * means UNCONSTRAINED — every published template in scope — which is what the
 * fan-out did when it shipped.
 */
export function effectiveFanOut(config: {
  adTemplateId?: string | null;
  fanOutTemplateIds?: string[] | null;
}): string[] {
  const set = (config.fanOutTemplateIds ?? []).filter(Boolean);
  if (set.length === 0) return [];
  const lead = (config.adTemplateId ?? '').trim();
  return lead && !set.includes(lead) ? [...set, lead] : [...set];
}
