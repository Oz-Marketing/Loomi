/**
 * The one link to an account's settings.
 *
 * An account's configuration used to be reachable three ways — the app-shell
 * sub-account rail, `/subaccount/<slug>/settings`, and the messaging-scoped
 * `/messaging/settings` tree — each with its own URL shape. It's one screen
 * now: Agency Settings → Accounts → the account, which the route below renders.
 *
 * Building the URL here rather than at each call site is what stops a fourth
 * shape appearing: the section is a `?tab=` value, not a path segment, because
 * the page is a single `[key]` route.
 */

/** Section keys the account settings page accepts. Mirrors its `TABS` list. */
export type AccountSettingsTab =
  | 'general'
  | 'branding'
  | 'domains'
  | 'integrations'
  | 'contact-fields'
  | 'email'
  | 'sms'
  | 'suppressions'
  | 'reports';

export function accountSettingsHref(accountKey: string, tab?: AccountSettingsTab): string {
  const base = `/settings/subaccounts/${encodeURIComponent(accountKey)}`;
  return tab ? `${base}?tab=${tab}` : base;
}
