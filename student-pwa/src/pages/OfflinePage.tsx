import React, { useState } from 'react';
import { WifiOff, RefreshCw, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { useNavigate } from 'react-router-dom';

export const OfflinePage: React.FC = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleRetry = () => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      if (navigator.onLine) {
        window.location.reload();
      } else {
        alert('You are still offline. Please check your data connection or Wi-Fi.');
      }
    }, 1200);
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-between p-3 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-sm flex flex-col items-center pt-4 sm:pt-8 min-w-0">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 mt-4 sm:mt-8 shadow-sm border border-slate-200/80 text-center min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <WifiOff className="w-6 h-6 sm:w-7 sm:h-7 text-slate-600" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-2">
            No Internet Connection
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6 break-words">
            Attendance verification requires an active internet connection to communicate securely with the university servers.
          </p>

          <button
            onClick={handleRetry}
            disabled={checking}
            type="button"
            className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 disabled:bg-blue-400 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors mb-2"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking Connection...' : 'Retry Connection'}
          </button>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full min-h-[38px] flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 py-2"
          >
            <Home className="w-3.5 h-3.5" />
            Back to Home
          </button>
        </div>
      </div>

      <div className="text-[10px] sm:text-[11px] text-slate-400 text-center py-3">
        Admiralty University of Nigeria · Offline Fallback
      </div>
    </div>
  );
};
