import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const ClosedPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Session Closed
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            This lecture attendance session has been closed or revoked by the lecturer. No further check-ins are allowed.
          </p>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Attendance Portal
      </div>
    </div>
  );
};
