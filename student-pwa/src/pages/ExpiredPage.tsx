import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, QrCode } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const ExpiredPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-between p-3 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-sm flex flex-col items-center pt-4 sm:pt-8 min-w-0">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 mt-4 sm:mt-8 shadow-sm border border-slate-200/80 text-center min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <Clock className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-2">
            Attendance Link Expired
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6 break-words">
            This attendance link has expired. Ask your lecturer to display or generate a new session code.
          </p>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <QrCode className="w-4 h-4" />
            Scan New Code
          </button>
        </div>
      </div>

      <div className="text-[10px] sm:text-[11px] text-slate-400 text-center py-3">
        Admiralty University of Nigeria · Attendance Portal
      </div>
    </div>
  );
};
