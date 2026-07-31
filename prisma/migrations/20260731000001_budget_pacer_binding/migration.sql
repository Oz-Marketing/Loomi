-- Phase 3 pacer binding: per-platform "this period's goals are owned by the
-- budget ledger" flags. See docs/budget-module.md §4 "Who owns the number".
-- Additive; defaults to false so every existing period stays hand-typed.
ALTER TABLE "MetaAdsPacerPeriodBudget" ADD COLUMN "managedByBudget" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MetaAdsPacerPeriodBudget" ADD COLUMN "googleManagedByBudget" BOOLEAN NOT NULL DEFAULT false;
