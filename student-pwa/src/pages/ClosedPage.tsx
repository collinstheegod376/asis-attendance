import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const ClosedPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-between p-3 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-sm flex flex-col items-center pt-4 sm:pt-8 min-w-0">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 mt-4 sm:mt-8 shadow-sm border border-slate-200/80 text-center min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <Lock className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-2">
            Session Closed
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6 break-words">
            This lecture attendance session has been closed or revoked by the lecturer. No further check-ins are allowed.
          </p>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </div>

      <div className="text-[10px] sm:text-[11px] text-slate-400 text-center py-3">
        Admiralty University of Nigeria · Attendance Portal
      </div>
    </div>
  );
};
