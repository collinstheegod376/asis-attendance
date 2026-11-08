import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const InvalidPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Invalid Attendance Link
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            The attendance token in this link is invalid, corrupted, or has been revoked. Ensure you scanned the official code displayed by your lecturer.
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
