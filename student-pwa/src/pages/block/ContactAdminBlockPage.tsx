import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { BlockPageLayout } from '../../components/BlockPageLayout';

export const ContactAdminBlockPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || 'BIND-204';
  const customReason = searchParams.get('reason');

  const defaultReason =
    refCode === 'BIND-200'
      ? 'Device fingerprint generation failed or was blocked by browser privacy settings. Contact the admin to reset your device, then try again.'
      : 'This device is not fully recognised. Contact the admin to reset your device, then try again.';

  return (
    <BlockPageLayout
      title="Device Not Recognised"
      reason={customReason || defaultReason}
      referenceCode={refCode}
      icon={<ShieldX className="w-8 h-8 text-rose-600" />}
      iconBgColor="bg-rose-50 border-rose-200"
      badgeText={refCode === 'BIND-200' ? 'Fail-Closed Gate' : 'Gate 1 · Unrecognised Binding'}
    />
  );
};
