import type { AccountSettingsTab } from '@/lib/account-settings-href';

/**
 * Old messaging-settings section → the account tab that replaced it.
 *
 * `/messaging/settings/*` held Sending, SMS and Suppressions because they're
 * coupled to the email engine. They're per-account config, though — each
 * account's own From address, Twilio credentials and suppression list — so they
 * became tabs on the account, where the rest of its configuration already was.
 * `sending` is labelled `email` there, which is what the tab has always been
 * called in the UI.
 */
export const MESSAGING_TAB_TO_ACCOUNT_TAB: Record<string, AccountSettingsTab> = {
  sending: 'email',
  sms: 'sms',
  suppressions: 'suppressions',
};

/** The section an old messaging URL was pointing at, defaulting to Email. */
export function accountTabForMessagingSection(section: string | undefined): AccountSettingsTab {
  return (section && MESSAGING_TAB_TO_ACCOUNT_TAB[section]) || 'email';
}
