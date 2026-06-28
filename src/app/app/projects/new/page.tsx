import { IntakeForm } from './_components/intake-form';

/**
 * File a ticket — the intake form. Internal-staff only (gated by the App
 * layout). Client form loads its pickers from /api/projects/options.
 */
export default function NewTicketPage() {
  return <IntakeForm />;
}
