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
export { StatusSelect } from './StatusSelect';
export {
  MetricBox,
  CompactStat,
  SectionLabel,
  Divider,
  UpdatesIndicator,
  AccountNotesButton,
} from './metrics';
export { PeriodSelector } from './PeriodSelector';
export { StatusBattery } from './StatusBattery';
export { CollapsibleSection } from './CollapsibleSection';
export { BudgetTypeToggle, BudgetSourceToggle } from './toggles';
export { UserPicker } from './UserPicker';
export {
  BudgetPanel,
  TotalAllocationHeader,
  EmptyPeriodState,
  AddPlanButton,
} from './budget-panels';
export {
  useDragReorder,
  type DragReorderApi,
  type DropEdge,
} from './use-drag-reorder';
export { AdSummaryRow } from './AdSummaryRow';
export { PacerRow, PacerCompletedSummary } from './PacerRow';
export { PlanAdForm } from './PlanAdForm';
export { AdEditorModal } from './AdEditorModal';
export { BudgetCalculatorModal } from './BudgetCalculatorModal';
