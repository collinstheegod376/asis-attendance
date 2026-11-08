import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { BlockPageLayout } from '../../components/BlockPageLayout';

export const SharedDeviceBlockPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || 'BIND-203';

  return (
    <BlockPageLayout
      title="Shared Device Blocked"
      reason="This device has already been used for another student in this session. Contact the admin."
      referenceCode={refCode}
      icon={<AlertTriangle className="w-8 h-8 text-amber-600" />}
      iconBgColor="bg-amber-50 border-amber-200"
      badgeText="Gate 4 · Same-Session Conflict"
    />
  );
};
