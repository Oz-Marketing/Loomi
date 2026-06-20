import { UserCircleIcon } from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/page-header';

export default function ReportingProfilePage() {
  return (
    <PageHeader
      icon={UserCircleIcon}
      title="Your profile"
      subtitle="Account details, password, and notification preferences land here."
    />
  );
}
