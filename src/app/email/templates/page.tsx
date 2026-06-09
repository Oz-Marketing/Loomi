// The /email/templates route. The view + its shared exports
// (EmailTemplatesPanel, TemplatesHeaderActionsContext, consumed by the unified
// /templates page) live in a sibling non-page module — a Next.js page file may
// only export a default component, so the panel/context can't be exported here.
export { default } from './email-templates-view';
