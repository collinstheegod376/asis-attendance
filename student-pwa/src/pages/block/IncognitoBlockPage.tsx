import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { EyeOff } from 'lucide-react';
import { BlockPageLayout } from '../../components/BlockPageLayout';

export const IncognitoBlockPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || 'BIND-205';

  return (
    <BlockPageLayout
      title="Private Browsing Detected"
      reason="Attendance is not allowed in Incognito. Open your normal browser."
      referenceCode={refCode}
      icon={<EyeOff className="w-8 h-8 text-amber-600" />}
      iconBgColor="bg-amber-50 border-amber-200"
      badgeText="Gate 0 · Incognito Protection"
    />
  );
};
