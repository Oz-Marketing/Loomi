// App-surface Settings = the SAME shared Settings page as Studio (one source of
// truth). The App host rewrites /settings → /app/settings, and the page reads
// the browser path via usePathname, so its /settings/* routing works unchanged.
export { default } from '@/app/settings/page';
