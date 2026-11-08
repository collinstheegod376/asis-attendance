import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, QrCode } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const ExpiredPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Attendance Link Expired
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            This attendance link has expired. Ask your lecturer to display or generate a new session code.
          </p>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <QrCode className="w-4 h-4" />
            Scan New Code
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Attendance Portal
      </div>
    </div>
  );
};
