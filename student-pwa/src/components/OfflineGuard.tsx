import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { OfflinePage } from '../pages/OfflinePage';

export const OfflineGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const location = useLocation();

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isGuardedRoute =
    location.pathname.startsWith('/join') || location.pathname.startsWith('/attend');

  if (isOffline && isGuardedRoute) {
    return <OfflinePage />;
  }

  return <>{children}</>;
};
