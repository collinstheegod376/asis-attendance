import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { BlockPageLayout } from '../../components/BlockPageLayout';

export const NewDeviceBlockPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || 'BIND-201';

  return (
    <BlockPageLayout
      title="New Device Detected"
      reason="New device detected. Contact the admin to reset your device, then try again."
      referenceCode={refCode}
      icon={<Smartphone className="w-8 h-8 text-blue-600" />}
      iconBgColor="bg-blue-50 border-blue-200"
      badgeText="Gate 1 · Device Binding Mismatch"
    />
  );
};
