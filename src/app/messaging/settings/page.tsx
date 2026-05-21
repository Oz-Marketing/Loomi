import { redirect } from 'next/navigation';

export default function MessagingSettingsRedirect() {
  redirect('/messaging/settings/sending');
}
