/**
 * Shared presentational primitives for the ad-pacer tools (Meta + Google).
 * Leaf components only — no Meta/Google-specific business logic. Both tools
 * import from here so their planner/pacer surfaces stay pixel-identical.
 */
export { PacerReadOnlyContext, usePacerReadOnly } from './pacer-read-only';
export { Tooltip } from './Tooltip';
export { FlightBar } from './FlightBar';
export {
  inputClass,
  readonlyClass,
  labelClass,
  DollarInput,
  Field,
} from './inputs';
export { AdStatusPill, ApprovalPill, DesignPill } from './pills';
