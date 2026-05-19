import { redirect } from 'next/navigation';

// The Template Library is now the canonical /templates page.
// Redirect any /templates/library traffic to /templates.
export default function TemplateLibraryRedirect() {
  redirect('/templates');
}
