import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { BlockPageLayout } from '../../components/BlockPageLayout';

export const DeviceInUseBlockPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || 'BIND-202';

  return (
    <BlockPageLayout
      title="Device Already Registered"
      reason="This device is registered to another student. Contact the admin if this is an error."
      referenceCode={refCode}
      icon={<Users className="w-8 h-8 text-rose-600" />}
      iconBgColor="bg-rose-50 border-rose-200"
      badgeText="Gate 1 · Conflict Detected"
    />
  );
};
