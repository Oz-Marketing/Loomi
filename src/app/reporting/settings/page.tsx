/**
 * Settings is unified across both surfaces — the same component renders
 * here and at /settings on studio. Internal navigation pushes paths
 * like `/settings/users`, which proxy.ts rewrites to
 * `/reporting/settings/users` when the request is on the reporting
 * host, hitting the mirror files in this folder.
 */
export { default } from '@/app/settings/page';
