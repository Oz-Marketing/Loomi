import type { CampaignPlanAsset } from './types';

/**
 * Classify an uploaded asset to a medium from its filename. Users typically
 * name files with the medium ("email-hero.jpg", "lp-banner.png", "form-bg.png").
 * The user can override the result via a dropdown in the UI. Unmatched files are
 * 'generic' and are usable by any medium.
 */
export function classifyAssetKind(filename: string): CampaignPlanAsset['kind'] {
  const f = filename.toLowerCase();
  if (f.includes('email')) return 'email';
  if (f.includes('landing') || f.includes('lp')) return 'landingPage';
  if (f.includes('form')) return 'form';
  return 'generic';
}

/** Assets relevant to a given medium (its own kind + generic). */
export function assetsForKind(
  assets: CampaignPlanAsset[] | undefined,
  kind: CampaignPlanAsset['kind'],
): CampaignPlanAsset[] {
  if (!assets?.length) return [];
  return assets.filter((a) => a.kind === kind || a.kind === 'generic');
}
