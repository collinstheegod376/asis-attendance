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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="w-7 h-7 text-slate-600" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-2">
            No Internet Connection
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            Attendance verification requires an active internet connection to communicate securely with the university servers.
          </p>

          <button
            onClick={handleRetry}
            disabled={checking}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 disabled:bg-blue-400 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors mb-2"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking Connection...' : 'Retry Connection'}
          </button>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 py-2"
          >
            <Home className="w-3.5 h-3.5" />
            Back to Home
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Offline Fallback
      </div>
    </div>
  );
};
